import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNativeObjectDetection, type NativeObjectDetection } from '../hooks/useNativeObjectDetection';
import { useNativeTextRecognition, type RecognizedTextBlock } from '../hooks/useNativeTextRecognition';
import { useObjectDetection, type WebObjectDetection } from '../hooks/useObjectDetection';
import { useScannerSession } from '../hooks/useScannerSession';
import { useWebTextRecognition, type WebTextBlock } from '../hooks/useWebTextRecognition';
import { createCapturedScan } from '../services/scanService';

const DETAIL_LEVELS = [
  { value: 'fast', label: 'Fast' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'high', label: 'High' },
] as const;

const AI_ANNOTATION_MIN_CONFIDENCE = 0.85;
const TEXT_ASSIST_MIN_OVERLAP = 0.08;
const TEXT_ASSIST_HINTS = [
  { label: 'Exit Sign', patterns: ['emergency exit', 'fire exit', 'exit'] },
  { label: 'Warning Sign', patterns: ['warning', 'caution', 'danger'] },
  { label: 'Stop Sign', patterns: ['stop'] },
  { label: 'Restroom Sign', patterns: ['restroom', 'bathroom', 'toilet'] },
  { label: 'Door Sign', patterns: ['push', 'pull', 'authorized', 'employees only'] },
  { label: 'Beverage Bottle', patterns: ['coca cola', 'pepsi', 'sprite', 'fanta', 'water'] },
];

type DetectionLike = WebObjectDetection | NativeObjectDetection;
type TextBlockLike = RecognizedTextBlock | WebTextBlock;
type WorldPosition = { x: number; y: number; z: number } | null;
type NormalizedRect = { x: number; y: number; width: number; height: number };

function defaultModelName() {
  const now = new Date();
  const date = now.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const time = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return `Scan ${date} ${time}`;
}

function normalizeWorldPosition(input: unknown): WorldPosition {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const point = input as { x?: number; y?: number; z?: number };
  const x = Number(point.x);
  const y = Number(point.y);
  const z = Number(point.z);

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }

  return { x, y, z };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function normalizeTextValue(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNormalizedRect(
  bbox: [number, number, number, number] | undefined,
  bboxNormalized: boolean,
  frameWidth: number,
  frameHeight: number,
): NormalizedRect {
  const [rawX, rawY, rawW, rawH] = Array.isArray(bbox) ? bbox : [0, 0, 0, 0];
  const x = Number(rawX || 0);
  const y = Number(rawY || 0);
  const width = Math.max(0, Number(rawW || 0));
  const height = Math.max(0, Number(rawH || 0));

  if (bboxNormalized) {
    return {
      x: clamp01(x),
      y: clamp01(y),
      width: clamp01(width),
      height: clamp01(height),
    };
  }

  const safeWidth = Math.max(1, Number(frameWidth || 1));
  const safeHeight = Math.max(1, Number(frameHeight || 1));

  return {
    x: clamp01(x / safeWidth),
    y: clamp01(y / safeHeight),
    width: clamp01(width / safeWidth),
    height: clamp01(height / safeHeight),
  };
}

function rectIntersectionOverUnion(a: NormalizedRect, b: NormalizedRect) {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(ax2, bx2);
  const y2 = Math.min(ay2, by2);
  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const interArea = interW * interH;

  if (interArea <= 0) {
    return 0;
  }

  const areaA = Math.max(0, a.width * a.height);
  const areaB = Math.max(0, b.width * b.height);
  const unionArea = areaA + areaB - interArea;

  if (unionArea <= 0) {
    return 0;
  }

  return interArea / unionArea;
}

function rectCenterInside(inner: NormalizedRect, outer: NormalizedRect) {
  const centerX = inner.x + inner.width * 0.5;
  const centerY = inner.y + inner.height * 0.5;

  return (
    centerX >= outer.x &&
    centerX <= outer.x + outer.width &&
    centerY >= outer.y &&
    centerY <= outer.y + outer.height
  );
}

function findTextHintLabel(rawText: string) {
  const normalized = normalizeTextValue(rawText);

  if (!normalized) {
    return '';
  }

  const hit = TEXT_ASSIST_HINTS.find((entry) => entry.patterns.some((pattern) => normalized.includes(pattern)));
  return hit ? hit.label : '';
}

function fuseDetectionsWithText({
  detections,
  textBlocks,
  fullText,
  frameWidth,
  frameHeight,
}: {
  detections: DetectionLike[];
  textBlocks: TextBlockLike[];
  fullText: string;
  frameWidth: number;
  frameHeight: number;
}) {
  if (!detections.length || !textBlocks.length) {
    return detections;
  }

  const normalizedBlocks = textBlocks
    .map((block, index) => ({
      id: String(block.id || `text-${index}`),
      text: String(block.text || '').trim(),
      rect: toNormalizedRect(block.bbox, Boolean(block.bboxNormalized), frameWidth, frameHeight),
    }))
    .filter((block) => block.text);

  if (!normalizedBlocks.length) {
    return detections;
  }

  const globalText = normalizeTextValue([String(fullText || ''), ...normalizedBlocks.map((block) => block.text)].join(' '));
  const globalHint = findTextHintLabel(globalText);

  return detections.map((detection) => {
    const normalizedRect = toNormalizedRect(
      detection.bbox,
      Boolean((detection as NativeObjectDetection).bboxNormalized),
      frameWidth,
      frameHeight,
    );
    const localText = normalizedBlocks
      .filter((block) => {
        const iou = rectIntersectionOverUnion(normalizedRect, block.rect);
        return iou >= TEXT_ASSIST_MIN_OVERLAP || rectCenterInside(normalizedRect, block.rect);
      })
      .map((block) => block.text)
      .join(' ');
    const localHint = findTextHintLabel(localText);
    const hintLabel = localHint || globalHint;

    let boostedScore = Number(detection.score || 0);

    if (localText) {
      boostedScore += 0.05;
    }

    if (localHint) {
      boostedScore += 0.14;
    } else if (globalHint) {
      boostedScore += 0.06;
    }

    return {
      ...detection,
      rawClass: String(detection.class || 'Object'),
      class: localHint ? localHint : String(detection.class || 'Object'),
      score: clamp01(boostedScore),
      textHint: hintLabel || undefined,
    };
  });
}

function buildAi3dAnnotations(detections: Array<DetectionLike & { rawClass?: string }>) {
  const seen = new Set<string>();

  return detections
    .filter((detection) => Number(detection.score || 0) >= AI_ANNOTATION_MIN_CONFIDENCE)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .map((detection, index) => {
      const worldPosition = normalizeWorldPosition((detection as NativeObjectDetection).worldPosition);

      if (!worldPosition) {
        return null;
      }

      const label = String(detection.class || 'Object').trim() || 'Object';
      const score = Math.round(Number(detection.score || 0) * 100);
      const key = `${label.toLowerCase()}-${Math.round(worldPosition.x * 100)}-${Math.round(worldPosition.y * 100)}-${Math.round(worldPosition.z * 100)}`;

      if (seen.has(key)) {
        return null;
      }

      seen.add(key);

      return {
        id: `ai-ann-${Date.now()}-${index}`,
        text: `${label} (${score}%)`,
        source: 'ai-detection',
        confidence: Number(detection.score || 0),
        position: worldPosition,
      };
    })
    .filter(Boolean);
}

function DetectionOverlay({
  videoRef,
  detections,
  visible,
  nativeMode,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  detections: DetectionLike[];
  visible: boolean;
  nativeMode: boolean;
}) {
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    const onResize = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!visible) {
    return null;
  }

  const video = videoRef.current;
  const sourceWidth = Number(video?.videoWidth || 0) || viewport.width;
  const sourceHeight = Number(video?.videoHeight || 0) || viewport.height;
  const scale = Math.max(viewport.width / sourceWidth, viewport.height / sourceHeight);
  const displayWidth = sourceWidth * scale;
  const displayHeight = sourceHeight * scale;
  const offsetX = (viewport.width - displayWidth) / 2;
  const offsetY = (viewport.height - displayHeight) / 2;

  return (
    <div className="absolute inset-0 pointer-events-none">
      {detections.map((detection) => {
        const [x, y, width, height] = detection.bbox;
        const useNormalized = nativeMode && 'bboxNormalized' in detection ? Boolean(detection.bboxNormalized) : false;
        const left = useNormalized ? x * viewport.width : offsetX + x * scale;
        const top = useNormalized ? y * viewport.height : offsetY + y * scale;
        const boxWidth = useNormalized ? width * viewport.width : width * scale;
        const boxHeight = useNormalized ? height * viewport.height : height * scale;
        const distanceMeters = Number((detection as NativeObjectDetection).distanceMeters);
        const distanceLabel = Number.isFinite(distanceMeters) && distanceMeters > 0 ? ` • ${distanceMeters.toFixed(1)}m` : '';

        return (
          <div
            key={detection.id}
            className="absolute rounded-md border border-emerald-300/90 bg-emerald-500/10 shadow-[0_0_12px_rgba(16,185,129,0.45)]"
            style={{
              left,
              top,
              width: boxWidth,
              height: boxHeight,
            }}
          >
            <div className="absolute -top-6 left-0 max-w-[180px] truncate rounded bg-emerald-500/85 px-2 py-0.5 text-[11px] font-semibold text-white">
              {detection.class} {Math.round(detection.score * 100)}%{distanceLabel}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TextRecognitionOverlay({
  videoRef,
  blocks,
  visible,
  nativeMode,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  blocks: TextBlockLike[];
  visible: boolean;
  nativeMode: boolean;
}) {
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    const onResize = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!visible) {
    return null;
  }

  const video = videoRef.current;
  const sourceWidth = Number(video?.videoWidth || 0) || viewport.width;
  const sourceHeight = Number(video?.videoHeight || 0) || viewport.height;
  const scale = Math.max(viewport.width / sourceWidth, viewport.height / sourceHeight);
  const displayWidth = sourceWidth * scale;
  const displayHeight = sourceHeight * scale;
  const offsetX = (viewport.width - displayWidth) / 2;
  const offsetY = (viewport.height - displayHeight) / 2;

  return (
    <div className="absolute inset-0 pointer-events-none">
      {blocks.map((block) => {
        const [x, y, width, height] = Array.isArray(block.bbox) ? block.bbox : [0, 0, 0, 0];
        const useNormalized = nativeMode || block.bboxNormalized;
        const left = useNormalized ? x * viewport.width : offsetX + x * scale;
        const top = useNormalized ? y * viewport.height : offsetY + y * scale;
        const boxWidth = useNormalized ? width * viewport.width : width * scale;
        const boxHeight = useNormalized ? height * viewport.height : height * scale;
        const snippet = String(block.text || '').trim();

        return (
          <div
            key={String(block.id || `${x}-${y}-${width}-${height}`)}
            className="absolute rounded-md border border-primary/80 bg-primary/10 shadow-[0_0_12px_rgba(20,184,166,0.35)]"
            style={{
              left,
              top,
              width: boxWidth,
              height: boxHeight,
            }}
          >
            {snippet ? (
              <div className="absolute -top-6 left-0 max-w-[220px] truncate rounded bg-primary/85 px-2 py-0.5 text-[11px] font-semibold text-white">
                {snippet}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function ScanPage() {
  const navigate = useNavigate();
  const webVideoRef = useRef<HTMLVideoElement | null>(null);
  const [showAiOverlay, setShowAiOverlay] = useState(true);
  const [speakDetections, setSpeakDetections] = useState(false);
  const [readModeEnabled, setReadModeEnabled] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [pendingModelName, setPendingModelName] = useState('');
  const [showScanSettings, setShowScanSettings] = useState(false);

  const {
    arEngine,
    capabilities,
    previewMode,
    isScanning,
    scanDistanceMeters,
    setScanDistanceMeters,
    scanDetailLevel,
    setScanDetailLevel,
    metrics,
    error,
    lastExport,
    initializeCapabilities,
    startPreview,
    stopPreview,
    startScan,
    stopScan,
  } = useScannerSession();

  const webDetectionEnabled = previewMode === 'web' && showAiOverlay;
  const nativeObjectDetectionSupported = Boolean(capabilities?.nativeObjectDetection);
  const nativeTextRecognitionSupported = Boolean(capabilities?.nativeTextRecognition);
  const nativeDetectionEnabled = previewMode === 'native' && showAiOverlay && nativeObjectDetectionSupported;
  const detectionEnabled = webDetectionEnabled || nativeDetectionEnabled;

  const {
    detections: webDetections,
    loadingModel: webDetectionModelLoading,
    modelError: webDetectionModelError,
    lastAnnouncement: webLastAnnouncement,
    announceNow: announceWebNow,
  } = useObjectDetection({
    videoRef: webVideoRef,
    enabled: webDetectionEnabled,
    speakEnabled: speakDetections,
    minScore: 0.55,
    maxDetections: 6,
  });

  const {
    detections: nativeDetections,
    labels: nativeLabels,
    loading: nativeDetectionLoading,
    error: nativeDetectionError,
    lastAnnouncement: nativeLastAnnouncement,
    announceNow: announceNativeNow,
  } = useNativeObjectDetection({
    enabled: nativeDetectionEnabled,
    speakEnabled: speakDetections,
    minConfidence: 0.55,
    intervalMs: 900,
  });

  const {
    blocks: nativeTextBlocks,
    text: nativeText,
    error: nativeTextError,
    speakNow: speakNativeTextNow,
  } = useNativeTextRecognition({
    enabled: previewMode === 'native' && readModeEnabled && nativeTextRecognitionSupported,
    speakEnabled: readModeEnabled,
    intervalMs: 1100,
  });

  const {
    blocks: webTextBlocks,
    text: webText,
    error: webTextError,
    supported: webTextSupported,
    speakNow: speakWebTextNow,
  } = useWebTextRecognition({
    enabled: previewMode === 'web' && readModeEnabled,
    speakEnabled: readModeEnabled,
    intervalMs: 1200,
    videoRef: webVideoRef,
  });

  useEffect(() => {
    void initializeCapabilities();
    void startPreview(webVideoRef.current);

    return () => {
      void stopPreview(webVideoRef.current);
    };
  }, [initializeCapabilities, startPreview, stopPreview]);

  const activeDetections = previewMode === 'native' ? nativeDetections : webDetections;
  const activeTextBlocks = previewMode === 'native' ? nativeTextBlocks : webTextBlocks;
  const activeReadText = previewMode === 'native' ? nativeText : webText;
  const frameWidth = Number(webVideoRef.current?.videoWidth || 0) || (typeof window === 'undefined' ? 1 : window.innerWidth || 1);
  const frameHeight =
    Number(webVideoRef.current?.videoHeight || 0) || (typeof window === 'undefined' ? 1 : window.innerHeight || 1);

  const fusedDetections = useMemo(
    () =>
      fuseDetectionsWithText({
        detections: activeDetections,
        textBlocks: activeTextBlocks,
        fullText: activeReadText,
        frameWidth,
        frameHeight,
      }),
    [activeDetections, activeReadText, activeTextBlocks, frameHeight, frameWidth],
  );

  const ai3dAnnotations = useMemo(
    () => buildAi3dAnnotations(fusedDetections as Array<DetectionLike & { rawClass?: string }>),
    [fusedDetections],
  );

  const detectionModelLoading = previewMode === 'native' ? nativeDetectionLoading : webDetectionModelLoading;
  const detectionModelError = previewMode === 'native' ? nativeDetectionError : webDetectionModelError;
  const lastAnnouncement = previewMode === 'native' ? nativeLastAnnouncement : webLastAnnouncement;
  const announceNow = previewMode === 'native' ? announceNativeNow : announceWebNow;
  const textRecognitionError = previewMode === 'native' ? nativeTextError : webTextError;
  const speakRecognizedTextNow = previewMode === 'native' ? speakNativeTextNow : speakWebTextNow;
  const readModeSupported =
    previewMode === 'native' ? nativeTextRecognitionSupported : previewMode === 'web' ? webTextSupported : false;

  const detectedLabels = useMemo(() => {
    if (fusedDetections.length) {
      return fusedDetections
        .slice(0, 3)
        .map((item) => {
          const distanceMeters = Number((item as NativeObjectDetection).distanceMeters);
          const distanceLabel = Number.isFinite(distanceMeters) && distanceMeters > 0 ? ` ${distanceMeters.toFixed(1)}m` : '';
          return `${item.class} ${Math.round(item.score * 100)}%${distanceLabel}`;
        })
        .join(' • ');
    }

    if (previewMode === 'native' && nativeLabels.length) {
      return nativeLabels.slice(0, 3).join(' • ');
    }

    return activeDetections
      .slice(0, 3)
      .map((item) => `${item.class} ${Math.round(item.score * 100)}%`)
      .join(' • ');
  }, [activeDetections, fusedDetections, nativeLabels, previewMode]);

  async function handleRecordToggle() {
    if (isScanning) {
      await stopScan(webVideoRef.current, {
        aiDetections: fusedDetections,
      });
      return;
    }

    await startScan(webVideoRef.current, {
      maxDistanceMeters: scanDistanceMeters,
      detailLevel: scanDetailLevel,
    });
  }

  async function handleCancel() {
    if (isScanning) {
      await stopScan(webVideoRef.current, {
        aiDetections: fusedDetections,
      });
    }

    await stopPreview(webVideoRef.current);
    navigate('/library');
  }

  function handleDone() {
    if (isFinalizing) {
      return;
    }

    setSaveError('');
    setPendingModelName((current) => (current.trim() ? current : defaultModelName()));
    setShowSavePrompt(true);
  }

  async function handleConfirmSave() {
    if (isFinalizing) {
      return;
    }

    setSaveError('');
    setIsFinalizing(true);
    let didSave = false;

    try {
      let exportData = lastExport;

      if (isScanning || !exportData) {
        const stoppedExport = await stopScan(webVideoRef.current, {
          aiDetections: fusedDetections,
        });

        if (stoppedExport) {
          exportData = stoppedExport;
        }
      }

      if (exportData) {
        const customTitle = pendingModelName.trim();
        const exportDetections = Array.isArray(exportData.aiDetections) ? exportData.aiDetections : [];
        const annotationsToSave = exportDetections.length ? buildAi3dAnnotations(exportDetections as Array<DetectionLike & { rawClass?: string }>) : ai3dAnnotations;
        const savedScan = await createCapturedScan({
          exportData,
          metrics,
          capabilities,
          title: customTitle || undefined,
          annotations: annotationsToSave,
        });

        didSave = true;
        navigate(`/viewer/${savedScan?.id || 'latest'}`);
        return;
      }

      setSaveError('No scan mesh was exported. Scan longer, then tap Done again.');
    } catch (saveFailure) {
      setSaveError(saveFailure instanceof Error ? saveFailure.message : 'Failed to save model on device.');
    } finally {
      setIsFinalizing(false);

      if (didSave) {
        setShowSavePrompt(false);
      }
    }
  }

  return (
    <div
      className={`font-display h-screen w-screen overflow-hidden text-slate-100 ${
        previewMode === 'native' ? 'bg-transparent' : 'bg-background-dark'
      }`}
    >
      <div className={`fixed inset-0 z-0 ${previewMode === 'native' ? 'bg-transparent' : 'bg-slate-900'}`}>
        <div id="native-camera-preview" className="absolute inset-0" />

        <video
          ref={webVideoRef}
          className={`absolute inset-0 h-full w-full object-cover ${previewMode === 'web' ? 'block' : 'hidden'}`}
          autoPlay
          muted
          playsInline
        />

        {previewMode !== 'web' && previewMode !== 'native' ? (
          <div
            className="absolute inset-0 opacity-50"
            style={{
              background:
                'linear-gradient(120deg, rgba(29,45,66,1) 0%, rgba(17,25,39,1) 100%)',
            }}
            aria-hidden="true"
          />
        ) : null}

        <div className="absolute inset-[16px] rounded-xl border-2 border-dashed border-[#2c4058]" />

        <DetectionOverlay
          videoRef={webVideoRef}
          detections={fusedDetections}
          visible={detectionEnabled}
          nativeMode={previewMode === 'native'}
        />

        <TextRecognitionOverlay
          videoRef={webVideoRef}
          blocks={activeTextBlocks}
          visible={readModeEnabled && activeTextBlocks.length > 0}
          nativeMode={previewMode === 'native'}
        />

        <div className="absolute inset-0 point-cloud-overlay opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/40" />
      </div>

      <div className="relative z-10 flex h-full flex-col overflow-y-auto overscroll-contain safe-area-top safe-area-x safe-area-bottom">
        <header className="flex items-center justify-between px-6 pb-4 pt-3">
          <button
            type="button"
            onClick={handleCancel}
            className="inline-flex min-w-[92px] items-center justify-center rounded-xl border border-slate-700 bg-background-dark/65 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800"
          >
            Cancel
          </button>

          <div className="text-center">
            <h1 className="text-lg font-bold leading-tight">Spacial Pro Scanner</h1>
            <p className="mt-1 text-[11px] uppercase tracking-wider text-slate-300">
              {arEngine} • {previewMode === 'native' ? 'Live Preview' : previewMode === 'web' ? 'Web Preview' : 'Preview'}
            </p>
          </div>

          <button
            type="button"
            onClick={handleDone}
            disabled={isFinalizing}
            className="inline-flex min-w-[92px] items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-70"
          >
            {isFinalizing ? 'Saving...' : 'Done'}
          </button>
        </header>

        <div className="px-6">
          <div className="relative rounded-3xl" style={{ minHeight: '62vh' }}>
            <div className="absolute left-[22px] top-[22px]">
              <span
                className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                  showAiOverlay ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40' : 'bg-slate-800/90 text-slate-300'
                }`}
              >
                Object Detection {showAiOverlay ? 'ON' : 'OFF'}
              </span>
            </div>
            <div className="absolute left-[22px] top-[54px]">
              <span
                className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                  readModeEnabled ? 'bg-primary/20 text-primary ring-1 ring-primary/40' : 'bg-slate-800/90 text-slate-300'
                }`}
              >
                Read Mode {readModeEnabled ? 'ON' : 'OFF'}
              </span>
            </div>

            <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3">
              <div className="rounded-full border border-slate-800 bg-background-dark/55 px-6 py-2 text-sm text-slate-200">
                {isScanning ? 'Move device slowly to capture more detail' : 'Tap Start Scan to begin AR capture'}
              </div>
              <div className="flex items-center justify-center gap-10">
                <button
                  type="button"
                  onClick={() => setShowScanSettings((current) => !current)}
                  className={`flex size-12 shrink-0 items-center justify-center rounded-full border transition-colors ${
                    showScanSettings
                      ? 'border-primary/60 bg-primary/20 text-primary'
                      : 'border-slate-700 bg-background-dark/60 text-slate-300 hover:text-white'
                  }`}
                >
                  <span className="material-symbols-outlined">settings</span>
                </button>

                <button
                  type="button"
                  onClick={handleRecordToggle}
                  className="group relative flex size-24 shrink-0 items-center justify-center rounded-full border-4 border-white bg-white/10"
                >
                  <div
                    className={`size-16 rounded-full shadow-[0_0_20px_rgba(239,68,68,0.5)] transition-transform group-active:scale-90 ${
                      isScanning ? 'bg-red-500' : 'bg-primary'
                    }`}
                  />
                  <div className="absolute -bottom-8 text-xs font-bold uppercase tracking-widest text-white">
                    {isScanning ? 'Recording' : 'Start Scan'}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setShowAiOverlay((current) => !current)}
                  className={`flex size-12 shrink-0 items-center justify-center rounded-full border transition-colors ${
                    showAiOverlay
                      ? 'border-emerald-400/70 bg-emerald-500/20 text-emerald-300'
                      : 'border-slate-700 bg-background-dark/60 text-slate-300 hover:text-white'
                  }`}
                >
                  <span className="material-symbols-outlined">layers</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mx-6 mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs text-red-300">
            {error}
          </div>
        ) : null}

        {saveError ? (
          <div className="mx-6 mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
            {saveError}
          </div>
        ) : null}

        {detectionModelError ? (
          <div className="mx-6 mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs text-red-300">
            Object detection error: {detectionModelError}
          </div>
        ) : null}

        {textRecognitionError ? (
          <div className="mx-6 mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
            Read mode error: {textRecognitionError}
          </div>
        ) : null}

        <section className="mx-6 mt-4 grid items-center gap-3 lg:grid-cols-[1fr_auto]">
          <div className="rounded-2xl border border-slate-800 bg-background-dark/55 p-4">
            <p className="text-sm font-bold text-white">Scan Settings</p>
            <p className="mt-1 text-sm text-slate-400">
              Range: {scanDistanceMeters.toFixed(1)}m • Detail: {scanDetailLevel.charAt(0).toUpperCase()}
              {scanDetailLevel.slice(1)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
              <span className="rounded-full border border-slate-700 px-3 py-1">Points {metrics.pointsCaptured.toFixed(1)}M</span>
              <span className="rounded-full border border-slate-700 px-3 py-1">Quality {Math.round(metrics.quality)}%</span>
              <span className="rounded-full border border-slate-700 px-3 py-1">Progress {Math.round(metrics.progress)}%</span>
            </div>
          </div>

          <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
            <button
              type="button"
              onClick={() => setShowAiOverlay((current) => !current)}
              className="rounded-xl border border-slate-700 bg-background-dark/55 px-4 py-3 text-sm font-semibold text-slate-100 hover:border-primary/50"
            >
              AI Overlay
            </button>
            <button
              type="button"
              disabled={!readModeSupported}
              onClick={() => setReadModeEnabled((current) => !current)}
              className="rounded-xl border border-slate-700 bg-background-dark/55 px-4 py-3 text-sm font-semibold text-slate-100 hover:border-primary/50 disabled:opacity-50"
            >
              Read Mode
            </button>
            <button
              type="button"
              onClick={handleRecordToggle}
              className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary/90"
            >
              {isScanning ? 'Stop Scan' : 'Start Scan'}
            </button>
          </div>
        </section>

        {showScanSettings ? (
          <div className="mx-6 mt-3 rounded-2xl border border-primary/40 bg-background-dark/70 p-4 backdrop-blur-md">
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-widest text-slate-400">Scan Distance</p>
                  <span className="text-sm font-bold text-primary">{scanDistanceMeters.toFixed(1)}m</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="0.5"
                  value={scanDistanceMeters}
                  onChange={(event) => setScanDistanceMeters(Number(event.target.value))}
                  disabled={isScanning}
                  className="mt-3 w-full accent-primary disabled:opacity-60"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  {[2, 4, 6, 8].map((value) => (
                    <button
                      key={value}
                      type="button"
                      disabled={isScanning}
                      onClick={() => setScanDistanceMeters(value)}
                      className={`rounded-lg border px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-60 ${
                        Math.abs(scanDistanceMeters - value) < 0.1
                          ? 'border-primary bg-primary/20 text-primary'
                          : 'border-slate-700 text-slate-300 hover:border-primary/50'
                      }`}
                    >
                      {value}m
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-widest text-slate-400">Detail</p>
                  <span className="text-sm font-bold text-primary">{scanDetailLevel}</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {DETAIL_LEVELS.map((detail) => (
                    <button
                      key={detail.value}
                      type="button"
                      disabled={isScanning}
                      onClick={() => setScanDetailLevel(detail.value)}
                      className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors disabled:opacity-60 ${
                        scanDetailLevel === detail.value
                          ? 'border-primary bg-primary/20 text-primary'
                          : 'border-slate-700 text-slate-300 hover:border-primary/50'
                      }`}
                    >
                      {detail.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <div className="border-t border-slate-700 pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-widest text-slate-400">Object Detection</p>
                  <span className={`text-xs font-semibold ${showAiOverlay ? 'text-emerald-300' : 'text-slate-400'}`}>
                    {showAiOverlay ? 'On' : 'Off'}
                  </span>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAiOverlay((current) => !current)}
                    className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                      showAiOverlay
                        ? 'border-emerald-400/70 bg-emerald-500/20 text-emerald-200'
                        : 'border-slate-700 text-slate-300 hover:border-emerald-500/50'
                    }`}
                  >
                    AI Overlay {showAiOverlay ? 'On' : 'Off'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSpeakDetections((current) => !current)}
                    className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                      speakDetections
                        ? 'border-primary bg-primary/20 text-primary'
                        : 'border-slate-700 text-slate-300 hover:border-primary/50'
                    }`}
                  >
                    Voice {speakDetections ? 'On' : 'Off'}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={announceNow}
                  disabled={!detectionEnabled || (!fusedDetections.length && !detectedLabels)}
                  className="mt-2 w-full rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-100 transition-colors hover:border-primary/60 hover:text-primary disabled:opacity-50"
                >
                  Announce Current Objects
                </button>
              </div>

              <div className="border-t border-slate-700 pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-widest text-slate-400">Read Mode</p>
                  <span className={`text-xs font-semibold ${readModeEnabled ? 'text-primary' : 'text-slate-400'}`}>
                    {readModeEnabled ? 'On' : 'Off'}
                  </span>
                </div>

                <div className="mt-2 grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    disabled={!readModeSupported}
                    onClick={() => setReadModeEnabled((current) => !current)}
                    className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      readModeEnabled
                        ? 'border-primary bg-primary/20 text-primary'
                        : 'border-slate-700 text-slate-300 hover:border-primary/50'
                    }`}
                  >
                    {readModeEnabled ? 'Stop Read Mode' : 'Start Read Mode'}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={speakRecognizedTextNow}
                  disabled={!readModeEnabled || !activeReadText}
                  className="mt-2 w-full rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-100 transition-colors hover:border-primary/60 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Read Current Text
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {detectionEnabled ? (
          <div className="mx-6 mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-200">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold uppercase tracking-wider">
                {detectionModelLoading ? 'Loading detector...' : fusedDetections.length || detectedLabels ? 'Detected' : 'No objects detected'}
              </span>
              {detectedLabels ? <span className="text-emerald-100">{detectedLabels}</span> : null}
              {lastAnnouncement ? <span className="text-emerald-300">Spoken: {lastAnnouncement}</span> : null}
              {ai3dAnnotations.length ? (
                <span className="text-primary">3D AI annotations ready: {ai3dAnnotations.length} (85%+)</span>
              ) : null}
            </div>
          </div>
        ) : null}

        {lastExport?.filePath ? (
          <div className="mx-6 mt-3 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-[11px] break-all text-primary">
            Exported scan: {lastExport.filePath}
          </div>
        ) : null}
      </div>

      {showSavePrompt ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 px-6">
          <form
            className="w-full max-w-sm rounded-xl border border-slate-700 bg-background-dark/95 p-4 shadow-2xl backdrop-blur-md"
            onSubmit={(event) => {
              event.preventDefault();
              void handleConfirmSave();
            }}
          >
            <p className="text-sm font-semibold text-slate-100">Save Scan</p>
            <p className="mt-1 text-xs text-slate-400">Choose a name for this model.</p>

            <input
              autoFocus
              type="text"
              value={pendingModelName}
              onChange={(event) => setPendingModelName(event.target.value)}
              placeholder="My Room Scan"
              className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-primary"
              maxLength={80}
            />

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSavePrompt(false)}
                disabled={isFinalizing}
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-slate-500 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isFinalizing}
                className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary/90 disabled:opacity-60"
              >
                {isFinalizing ? 'Saving...' : 'Save Model'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
