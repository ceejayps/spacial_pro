import type { RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

const DETECTION_INTERVAL_MS = 520;
const SPEECH_COOLDOWN_MS = 5500;
const SPEECH_REPEAT_WINDOW_MS = 15000;
const DEFAULT_MODEL_BASE = 'mobilenet_v1';

type ModelBase = 'mobilenet_v1' | 'mobilenet_v2' | 'lite_mobilenet_v2';

type RawDetection = {
  class?: string;
  score?: number;
  bbox?: number[];
};

type DetectionModel = {
  detect: (video: HTMLVideoElement, maxDetections?: number) => Promise<RawDetection[]>;
};

export type WebObjectDetection = {
  id: string;
  class: string;
  score: number;
  bbox: [number, number, number, number];
};

type UseObjectDetectionOptions = {
  videoRef: RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  speakEnabled: boolean;
  minScore?: number;
  maxDetections?: number;
};

function resolveModelBase(): ModelBase {
  const raw = String(import.meta.env?.VITE_OBJECT_DETECTION_BASE || DEFAULT_MODEL_BASE)
    .trim()
    .toLowerCase();

  if (raw === 'lite_mobilenet_v2' || raw === 'mobilenet_v2' || raw === 'mobilenet_v1') {
    return raw;
  }

  return DEFAULT_MODEL_BASE;
}

function toBboxTuple(value: number[] | undefined): [number, number, number, number] {
  if (!Array.isArray(value)) {
    return [0, 0, 0, 0];
  }

  return [
    Number(value[0] || 0),
    Number(value[1] || 0),
    Number(value[2] || 0),
    Number(value[3] || 0),
  ];
}

function normalizeDetections(rawDetections: RawDetection[], minScore: number, maxDetections: number): WebObjectDetection[] {
  return (rawDetections || [])
    .filter((item) => Number(item?.score || 0) >= minScore)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, maxDetections)
    .map((item, index) => ({
      id: `${item.class || 'object'}-${index}-${Math.round(Number(item.score || 0) * 1000)}`,
      class: String(item.class || 'Object'),
      score: Number(item.score || 0),
      bbox: toBboxTuple(item.bbox),
    }));
}

function detectionSummary(detections: WebObjectDetection[]) {
  const uniqueLabels: string[] = [];
  const seen = new Set<string>();

  detections.forEach((detection) => {
    const label = String(detection.class || '').trim().toLowerCase();

    if (!label || seen.has(label)) {
      return;
    }

    seen.add(label);
    uniqueLabels.push(label);
  });

  return uniqueLabels.slice(0, 3);
}

export function useObjectDetection({
  videoRef,
  enabled,
  speakEnabled,
  minScore = 0.55,
  maxDetections = 6,
}: UseObjectDetectionOptions) {
  const modelRef = useRef<DetectionModel | null>(null);
  const detectionsRef = useRef<WebObjectDetection[]>([]);
  const lastSpokenAtRef = useRef(0);
  const lastSpokenKeyRef = useRef('');

  const [detections, setDetections] = useState<WebObjectDetection[]>([]);
  const [loadingModel, setLoadingModel] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [modelError, setModelError] = useState('');
  const [lastAnnouncement, setLastAnnouncement] = useState('');

  useEffect(() => {
    detectionsRef.current = detections;
  }, [detections]);

  const announceDetections = useCallback((items: WebObjectDetection[], force = false) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      return false;
    }

    const labels = detectionSummary(items);

    if (!labels.length) {
      return false;
    }

    const key = labels.join('|');
    const now = Date.now();
    const elapsedSinceLast = now - lastSpokenAtRef.current;

    if (!force) {
      if (elapsedSinceLast < SPEECH_COOLDOWN_MS) {
        return false;
      }

      if (lastSpokenKeyRef.current === key && elapsedSinceLast < SPEECH_REPEAT_WINDOW_MS) {
        return false;
      }
    }

    const phrase = labels.length > 1 ? `I see ${labels.join(', ')}` : `I see ${labels[0]}`;
    const utterance = new SpeechSynthesisUtterance(phrase);
    utterance.rate = 1;
    utterance.pitch = 1;

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);

    lastSpokenAtRef.current = now;
    lastSpokenKeyRef.current = key;
    setLastAnnouncement(phrase);
    return true;
  }, []);

  const announceNow = useCallback(() => announceDetections(detectionsRef.current, true), [announceDetections]);

  useEffect(() => {
    if (!enabled) {
      setDetections([]);
      return;
    }

    if (modelRef.current) {
      return;
    }

    let cancelled = false;

    const loadModel = async () => {
      setLoadingModel(true);
      setModelReady(false);
      setModelError('');

      try {
        const tf = await import('@tensorflow/tfjs');
        await tf.ready();
        const cocoSsd = await import('@tensorflow-models/coco-ssd');
        const loadedModel = await cocoSsd.load({
          base: resolveModelBase(),
        });

        if (!cancelled) {
          modelRef.current = loadedModel as unknown as DetectionModel;
          setModelReady(true);
        }
      } catch (error) {
        if (!cancelled) {
          setModelReady(false);
          setModelError(error instanceof Error ? error.message : 'Failed to load object detection model.');
        }
      } finally {
        if (!cancelled) {
          setLoadingModel(false);
        }
      }
    };

    void loadModel();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !modelReady || !modelRef.current) {
      return;
    }

    let cancelled = false;
    let rafId = 0;
    let busy = false;
    let lastRunAt = 0;

    const run = async (timeStamp: number) => {
      if (cancelled) {
        return;
      }

      rafId = window.requestAnimationFrame(run);

      if (busy || timeStamp - lastRunAt < DETECTION_INTERVAL_MS) {
        return;
      }

      const videoElement = videoRef?.current;

      if (!videoElement || videoElement.readyState < 2 || !videoElement.videoWidth || !videoElement.videoHeight) {
        return;
      }

      busy = true;
      lastRunAt = timeStamp;

      try {
        const raw = await modelRef.current!.detect(videoElement, maxDetections);

        if (cancelled) {
          return;
        }

        const normalized = normalizeDetections(raw, minScore, maxDetections);
        setDetections(normalized);
      } catch (error) {
        if (!cancelled) {
          setModelError(error instanceof Error ? error.message : 'Object detection failed.');
        }
      } finally {
        busy = false;
      }
    };

    rafId = window.requestAnimationFrame(run);

    return () => {
      cancelled = true;

      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [enabled, maxDetections, minScore, modelReady, videoRef]);

  useEffect(() => {
    if (!speakEnabled || !enabled || !detections.length) {
      return;
    }

    announceDetections(detections);
  }, [announceDetections, detections, enabled, speakEnabled]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    detections,
    loadingModel,
    modelError,
    lastAnnouncement,
    announceNow,
  };
}
