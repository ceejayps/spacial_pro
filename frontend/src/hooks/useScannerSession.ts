import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScanExportResult, ScannerCapabilities } from '../plugins/lidarScanner';
import {
  exportNativeScan,
  getAREngineLabel,
  getNativeScanStatus,
  getScannerCapabilities,
  isNativeRuntime,
  startCameraPreview,
  startNativeScan,
  stopCameraPreview,
  stopNativeScan,
} from '../services/scannerService';

const SCAN_TICK_MS = 900;
const WEB_FRAME_CAPTURE_MS = 180;
const MAX_WEB_DEPTH_FRAMES = 180;

type ScanDetailLevel = 'fast' | 'balanced' | 'high';
type PreviewMode = 'idle' | 'failed' | 'web' | 'native';

type ScannerMetrics = {
  pointsCaptured: number;
  estimatedAccuracyMm: number;
  quality: number;
  progress: number;
};

type ScannerSessionCapabilities = ScannerCapabilities & {
  nativeObjectDetection: boolean;
  nativeTextRecognition: boolean;
};

type WebDepthFrame = {
  gridWidth: number;
  gridHeight: number;
  depthMap: Float32Array;
  sharpness: number;
  capturedAtMs: number;
};

type MergedDepthFrame = {
  gridWidth: number;
  gridHeight: number;
  depthMap: Float32Array;
};

type ScannerExportData = ScanExportResult & {
  fileBlob?: Blob;
  fileSizeBytes?: number;
  maxDistanceMeters?: number;
  detailLevel?: string;
  textureIncluded?: boolean;
  uvEnabled?: boolean;
  aiDetections?: unknown[];
};

type StartScanOptions = {
  maxDistanceMeters?: number;
  detailLevel?: string;
};

type StopScanOptions = {
  aiDetections?: unknown[];
};

const initialMetrics: ScannerMetrics = {
  pointsCaptured: 25.4,
  estimatedAccuracyMm: 5,
  quality: 85,
  progress: 33,
};

function formatPoints(pointsInMillions: number) {
  return `${pointsInMillions.toFixed(1)}M`;
}

function initialCapabilities(): ScannerSessionCapabilities {
  return {
    platform: 'unknown',
    arEngine: getAREngineLabel(),
    arSupported: false,
    lidarSupported: false,
    depthApi: 'none',
    cameraAvailable: true,
    nativeObjectDetection: false,
    nativeTextRecognition: false,
  };
}

function toMillions(pointsCaptured: number | undefined) {
  return Math.max(0, Number(pointsCaptured || 0) / 1_000_000);
}

function detailToGridSize(detailLevel: string) {
  const normalized = String(detailLevel || '').toLowerCase();

  if (normalized === 'fast') {
    return 88;
  }

  if (normalized === 'high') {
    return 196;
  }

  return 136;
}

function normalizeGridSize(videoWidth: number, videoHeight: number, baseWidth: number) {
  const width = Math.max(32, Math.floor(baseWidth));
  const ratio = videoHeight > 0 ? videoWidth / videoHeight : 16 / 9;
  const height = Math.max(24, Math.floor(width / Math.max(0.6, Math.min(2.2, ratio))));
  return { width, height };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function smoothDepthMap(depthMap: Float32Array, width: number, height: number, passes = 2) {
  if (width < 3 || height < 3) {
    return depthMap;
  }

  const current = new Float32Array(depthMap);
  const temp = new Float32Array(depthMap.length);

  for (let pass = 0; pass < passes; pass += 1) {
    temp.set(current);

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        const center = temp[index] * 4;
        const cardinals = temp[index - 1] + temp[index + 1] + temp[index - width] + temp[index + width];
        const diagonals =
          temp[index - width - 1] +
          temp[index - width + 1] +
          temp[index + width - 1] +
          temp[index + width + 1];

        current[index] = (center + cardinals * 2 + diagonals) / 16;
      }
    }
  }

  return current;
}

function bilateralSmoothDepthMap(
  depthMap: Float32Array,
  width: number,
  height: number,
  passes = 2,
  rangeSigma = 0.08,
) {
  if (width < 3 || height < 3) {
    return depthMap;
  }

  const output = new Float32Array(depthMap);
  const source = new Float32Array(depthMap.length);
  const spatialWeights = [0.5, 0.78, 0.5, 0.78, 1, 0.78, 0.5, 0.78, 0.5];
  const safeSigma = Math.max(1e-4, rangeSigma);
  const denominator = 2 * safeSigma * safeSigma;

  for (let pass = 0; pass < passes; pass += 1) {
    source.set(output);

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const centerIndex = y * width + x;
        const centerDepth = source[centerIndex];
        let weightedSum = 0;
        let totalWeight = 0;
        let weightIndex = 0;

        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            const neighborIndex = (y + oy) * width + (x + ox);
            const neighborDepth = source[neighborIndex];
            const delta = neighborDepth - centerDepth;
            const rangeWeight = Math.exp(-(delta * delta) / denominator);
            const weight = spatialWeights[weightIndex] * rangeWeight;

            weightedSum += neighborDepth * weight;
            totalWeight += weight;
            weightIndex += 1;
          }
        }

        output[centerIndex] = totalWeight > 0 ? weightedSum / totalWeight : centerDepth;
      }
    }
  }

  return output;
}

function captureWebDepthFrame(videoElement: HTMLVideoElement | null, detailLevel: string): WebDepthFrame | null {
  const width = Number(videoElement?.videoWidth || 0);
  const height = Number(videoElement?.videoHeight || 0);

  if (!videoElement || width < 32 || height < 24) {
    return null;
  }

  const baseGrid = detailToGridSize(detailLevel);
  const grid = normalizeGridSize(width, height, baseGrid);
  const canvas = document.createElement('canvas');
  canvas.width = grid.width;
  canvas.height = grid.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    return null;
  }

  context.drawImage(videoElement, 0, 0, grid.width, grid.height);
  const image = context.getImageData(0, 0, grid.width, grid.height);
  const pixels = image.data;
  const pointCount = grid.width * grid.height;
  const luminance = new Float32Array(pointCount);

  for (let index = 0; index < pointCount; index += 1) {
    const pixelIndex = index * 4;
    const r = pixels[pixelIndex] / 255;
    const g = pixels[pixelIndex + 1] / 255;
    const b = pixels[pixelIndex + 2] / 255;
    luminance[index] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  const depthMap = new Float32Array(pointCount);
  let sharpnessAccum = 0;

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const index = y * grid.width + x;
      const center = luminance[index];
      const left = x > 0 ? luminance[index - 1] : center;
      const right = x < grid.width - 1 ? luminance[index + 1] : center;
      const up = y > 0 ? luminance[index - grid.width] : center;
      const down = y < grid.height - 1 ? luminance[index + grid.width] : center;

      const gx = right - left;
      const gy = down - up;
      const gradient = Math.sqrt(gx * gx + gy * gy);
      sharpnessAccum += gradient;

      const laplacian = clamp01((4 * center - left - right - up - down + 1) * 0.5);
      const localMean = (left + right + up + down) * 0.25;
      const localContrast = clamp01(Math.abs(center - localMean) * 2.2);
      const nx = (x / Math.max(1, grid.width - 1)) * 2 - 1;
      const ny = (y / Math.max(1, grid.height - 1)) * 2 - 1;
      const centerBias = 1 - clamp01(Math.sqrt(nx * nx + ny * ny) / 1.4142);
      const gammaLuma = Math.pow(clamp01(center), 0.88);

      // Heuristic pseudo-depth based on luminance, edge contrast, and local detail.
      depthMap[index] = clamp01(gammaLuma * 0.5 + laplacian * 0.25 + localContrast * 0.17 + centerBias * 0.08);
    }
  }

  return {
    gridWidth: grid.width,
    gridHeight: grid.height,
    depthMap: bilateralSmoothDepthMap(
      smoothDepthMap(depthMap, grid.width, grid.height, 1),
      grid.width,
      grid.height,
      1,
    ),
    sharpness: sharpnessAccum / Math.max(1, pointCount),
    capturedAtMs: Date.now(),
  };
}

function mergeDepthFrames(depthFrames: WebDepthFrame[]): MergedDepthFrame | null {
  const frames = Array.isArray(depthFrames) ? depthFrames.filter(Boolean) : [];

  if (!frames.length) {
    return null;
  }

  const width = Number(frames[0]?.gridWidth || 0);
  const height = Number(frames[0]?.gridHeight || 0);
  const pointCount = width * height;

  if (width < 2 || height < 2 || pointCount < 4) {
    return null;
  }

  const compatible = frames.filter(
    (frame) =>
      Number(frame?.gridWidth || 0) === width &&
      Number(frame?.gridHeight || 0) === height &&
      frame.depthMap instanceof Float32Array &&
      frame.depthMap.length === pointCount,
  );

  if (!compatible.length) {
    return null;
  }

  const combined = new Float32Array(pointCount);
  const frameCount = compatible.length;

  for (let index = 0; index < pointCount; index += 1) {
    let sum = 0;
    let min = 1;
    let max = 0;

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const value = clamp01(compatible[frameIndex].depthMap[index]);
      sum += value;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }

    if (frameCount >= 4) {
      combined[index] = (sum - min - max) / Math.max(1, frameCount - 2);
      continue;
    }

    combined[index] = sum / Math.max(1, frameCount);
  }

  return {
    gridWidth: width,
    gridHeight: height,
    depthMap: bilateralSmoothDepthMap(smoothDepthMap(combined, width, height, 2), width, height, 3),
  };
}

async function exportWebObjFromVideoFrame({
  videoElement,
  maxDistanceMeters,
  detailLevel,
  depthFrames,
  aiDetections,
}: {
  videoElement: HTMLVideoElement | null;
  maxDistanceMeters: number;
  detailLevel: string;
  depthFrames?: WebDepthFrame[];
  aiDetections?: unknown[];
}): Promise<ScannerExportData> {
  const width = Number(videoElement?.videoWidth || 0);
  const height = Number(videoElement?.videoHeight || 0);

  if (!videoElement || width < 32 || height < 24) {
    throw new Error('Camera frame is not ready yet. Wait 1-2 seconds after preview starts.');
  }

  let mergedDepth = mergeDepthFrames(depthFrames || []);

  if (!mergedDepth) {
    const captured = captureWebDepthFrame(videoElement, detailLevel);

    if (!captured) {
      throw new Error('Unable to extract depth frame for web scan export.');
    }

    mergedDepth = {
      gridWidth: captured.gridWidth,
      gridHeight: captured.gridHeight,
      depthMap: captured.depthMap,
    };
  }

  const modelScale = Math.max(0.8, Math.min(6.0, Number(maxDistanceMeters || 5)));
  const depthScale = modelScale * 0.72;
  const nearDepth = Math.max(0.18, modelScale * 0.18);
  const fovDegrees = 62;
  const gridWidth = mergedDepth.gridWidth;
  const gridHeight = mergedDepth.gridHeight;
  const depthMap = mergedDepth.depthMap;
  const cx = (gridWidth - 1) * 0.5;
  const cy = (gridHeight - 1) * 0.5;
  const fx = cx / Math.tan((fovDegrees * Math.PI) / 360);
  const fy = cy / Math.tan((fovDegrees * Math.PI) / 360);
  const lines: string[] = ['# LiDAR Pro Web OBJ export'];

  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const index = y * gridWidth + x;
      const normalizedDepth = depthMap[index];
      const depthMeters = nearDepth + Math.pow(clamp01(normalizedDepth), 1.12) * depthScale;
      const vx = ((x - cx) / Math.max(1, fx)) * depthMeters;
      const vy = (-(y - cy) / Math.max(1, fy)) * depthMeters;
      const vz = -depthMeters;

      lines.push(`v ${vx.toFixed(6)} ${vy.toFixed(6)} ${vz.toFixed(6)}`);
    }
  }

  const vertexAt = (x: number, y: number) => y * gridWidth + x + 1;
  let faceCount = 0;

  for (let y = 0; y < gridHeight - 1; y += 1) {
    for (let x = 0; x < gridWidth - 1; x += 1) {
      const v1 = vertexAt(x, y);
      const v2 = vertexAt(x + 1, y);
      const v3 = vertexAt(x, y + 1);
      const v4 = vertexAt(x + 1, y + 1);

      const d1 = depthMap[y * gridWidth + x];
      const d2 = depthMap[y * gridWidth + x + 1];
      const d3 = depthMap[(y + 1) * gridWidth + x];
      const d4 = depthMap[(y + 1) * gridWidth + x + 1];
      const maxDepth = Math.max(d1, d2, d3, d4);
      const minDepth = Math.min(d1, d2, d3, d4);
      const avgDepth = (d1 + d2 + d3 + d4) * 0.25;
      const quadEdgeThreshold = 0.08 + (1 - avgDepth) * 0.14;

      if (maxDepth - minDepth > quadEdgeThreshold) {
        continue;
      }

      lines.push(`f ${v1} ${v2} ${v3}`);
      lines.push(`f ${v2} ${v4} ${v3}`);
      faceCount += 2;
    }
  }

  const fileBlob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const fileUrl = URL.createObjectURL(fileBlob);

  return {
    format: 'obj',
    fileBlob,
    fileUrl,
    filePath: '',
    vertexCount: gridWidth * gridHeight,
    faceCount,
    fileSizeBytes: fileBlob.size,
    maxDistanceMeters: modelScale,
    detailLevel: detailLevel || 'balanced',
    textureIncluded: false,
    uvEnabled: false,
    aiDetections: Array.isArray(aiDetections) ? aiDetections : [],
  };
}

export function useScannerSession() {
  const [previewMode, setPreviewMode] = useState<PreviewMode>('idle');
  const [isScanning, setIsScanning] = useState(false);
  const [scanDistanceMeters, setScanDistanceMeters] = useState(5);
  const [scanDetailLevel, setScanDetailLevel] = useState<ScanDetailLevel>('high');
  const [error, setError] = useState('');
  const [metrics, setMetrics] = useState<ScannerMetrics>(initialMetrics);
  const [capabilities, setCapabilities] = useState<ScannerSessionCapabilities>(initialCapabilities);
  const [lastExport, setLastExport] = useState<ScannerExportData | null>(null);
  const tickRef = useRef<number | null>(null);
  const webCaptureTickRef = useRef<number | null>(null);
  const webDepthFramesRef = useRef<WebDepthFrame[]>([]);
  const currentScanConfigRef = useRef<{
    maxDistanceMeters: number;
    detailLevel: string;
  }>({
    maxDistanceMeters: 5,
    detailLevel: 'balanced',
  });

  const initializeCapabilities = useCallback(async () => {
    const nextCapabilities = await getScannerCapabilities();
    setCapabilities({
      ...initialCapabilities(),
      ...nextCapabilities,
      nativeObjectDetection: Boolean(nextCapabilities.nativeObjectDetection),
      nativeTextRecognition: Boolean(nextCapabilities.nativeTextRecognition),
    });
  }, []);

  const startPreview = useCallback(async (webVideoElement: HTMLVideoElement | null) => {
    setError('');

    try {
      const [nextCapabilities, previewResult] = await Promise.all([
        getScannerCapabilities(),
        startCameraPreview({ webVideoElement }),
      ]);

      setCapabilities({
        ...initialCapabilities(),
        ...nextCapabilities,
        nativeObjectDetection: Boolean(nextCapabilities.nativeObjectDetection),
        nativeTextRecognition: Boolean(nextCapabilities.nativeTextRecognition),
      });
      setPreviewMode(previewResult.mode);
    } catch (err) {
      setPreviewMode('failed');
      setError(err instanceof Error ? err.message : 'Failed to start camera preview.');
    }
  }, []);

  const stopPreview = useCallback(async (webVideoElement: HTMLVideoElement | null) => {
    await stopCameraPreview({ webVideoElement });
    setPreviewMode('idle');
  }, []);

  const stopTicker = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }

    if (webCaptureTickRef.current !== null) {
      window.clearInterval(webCaptureTickRef.current);
      webCaptureTickRef.current = null;
    }
  }, []);

  const stopScan = useCallback(
    async (webVideoElement: HTMLVideoElement | null = null, options: StopScanOptions = {}) => {
      stopTicker();
      setIsScanning(false);
      let exportedData: ScannerExportData | null = null;

      if (isNativeRuntime()) {
        try {
          const stopResult = await stopNativeScan();

          if (typeof stopResult?.pointsCaptured !== 'undefined') {
            setMetrics((current) => ({
              ...current,
              pointsCaptured: toMillions(stopResult.pointsCaptured),
              quality: Math.max(current.quality, Number(stopResult.progress || current.quality)),
              progress: Number(stopResult.progress || current.progress),
            }));
          }

          const nativeExport = await exportNativeScan();
          exportedData = {
            ...nativeExport,
            aiDetections: Array.isArray(options.aiDetections) ? options.aiDetections : [],
          };
          setLastExport(exportedData);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to stop or export scan.');
        }

        return exportedData;
      }

      try {
        exportedData = await exportWebObjFromVideoFrame({
          videoElement: webVideoElement,
          maxDistanceMeters: currentScanConfigRef.current.maxDistanceMeters,
          detailLevel: currentScanConfigRef.current.detailLevel,
          depthFrames: webDepthFramesRef.current,
          aiDetections: options.aiDetections,
        });

        setLastExport(exportedData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to export web/android scan.');
      }

      return exportedData;
    },
    [stopTicker],
  );

  const startScan = useCallback(
    async (webVideoElement: HTMLVideoElement | null, options: StartScanOptions = {}) => {
      setError('');
      setLastExport(null);

      if (isNativeRuntime()) {
        try {
          if (previewMode === 'idle' || previewMode === 'failed') {
            const previewResult = await startCameraPreview({ webVideoElement });
            setPreviewMode(previewResult.mode);
          }

          const result = await startNativeScan({
            maxDistanceMeters: Number(options.maxDistanceMeters || scanDistanceMeters),
            detailLevel: String(options.detailLevel || scanDetailLevel),
          });

          if (result?.running === false) {
            throw new Error('Native scan did not start.');
          }

          setIsScanning(true);

          tickRef.current = window.setInterval(async () => {
            try {
              const status = await getNativeScanStatus();

              setMetrics((current) => {
                const nextProgress = Number(status?.progress || current.progress);
                const nextPoints = toMillions(status?.pointsCaptured);

                return {
                  pointsCaptured: nextPoints,
                  estimatedAccuracyMm: nextProgress > 70 ? 3 : 5,
                  quality: Math.max(current.quality, Math.min(99, 60 + nextProgress * 0.35)),
                  progress: nextProgress,
                };
              });
            } catch {
              // Ignore individual polling failures while scanning.
            }
          }, SCAN_TICK_MS);

          return;
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to start native scan.');
          return;
        }
      }

      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current);
      }

      currentScanConfigRef.current = {
        maxDistanceMeters: Number(options.maxDistanceMeters || scanDistanceMeters),
        detailLevel: String(options.detailLevel || scanDetailLevel || 'balanced'),
      };
      webDepthFramesRef.current = [];
      setIsScanning(true);

      webCaptureTickRef.current = window.setInterval(() => {
        const capturedFrame = captureWebDepthFrame(webVideoElement, currentScanConfigRef.current.detailLevel);

        if (!capturedFrame) {
          return;
        }

        webDepthFramesRef.current.push(capturedFrame);

        if (webDepthFramesRef.current.length > MAX_WEB_DEPTH_FRAMES) {
          webDepthFramesRef.current.shift();
        }
      }, WEB_FRAME_CAPTURE_MS);

      tickRef.current = window.setInterval(() => {
        const depthFrameCount = webDepthFramesRef.current.length;
        const maxPoints = Math.max(1, detailToGridSize(currentScanConfigRef.current.detailLevel) ** 2);
        const estimatedPoints = Math.min(maxPoints, depthFrameCount * Math.max(350, maxPoints / 7));
        const estimatedProgress = Math.min(100, depthFrameCount * 2.8);

        setMetrics((current) => {
          const targetQuality = Math.min(97, 58 + Math.sqrt(depthFrameCount) * 6.3);
          const nextQuality = Math.max(current.quality, targetQuality);
          const nextProgress = Math.max(current.progress, estimatedProgress);
          const nextPoints = Math.max(current.pointsCaptured, estimatedPoints / 1_000_000);

          return {
            pointsCaptured: nextPoints,
            estimatedAccuracyMm: nextProgress > 70 ? 3 : 5,
            quality: nextQuality,
            progress: nextProgress,
          };
        });
      }, SCAN_TICK_MS);
    },
    [previewMode, scanDistanceMeters, scanDetailLevel],
  );

  useEffect(() => {
    return () => {
      stopTicker();
    };
  }, [stopTicker]);

  return {
    arEngine: capabilities.arEngine,
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
    formattedPoints: formatPoints(metrics.pointsCaptured),
    initializeCapabilities,
    startPreview,
    stopPreview,
    startScan,
    stopScan,
  };
}
