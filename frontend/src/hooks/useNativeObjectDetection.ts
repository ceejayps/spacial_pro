import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addNativeObjectDetectionListener,
  getNativeObjectDetectionStatus,
  startNativeObjectDetection,
  stopNativeObjectDetection,
} from '../services/scannerService';

const SPEECH_COOLDOWN_MS = 5500;
const SPEECH_REPEAT_WINDOW_MS = 15000;

type RawWorldPosition = {
  x?: number;
  y?: number;
  z?: number;
};

type RawNativeDetection = {
  id?: string;
  class?: string;
  score?: number;
  bbox?: number[];
  bboxNormalized?: boolean;
  worldPosition?: RawWorldPosition;
  worldPositionAvailable?: boolean;
  distanceMeters?: number;
  source?: string;
};

type NativeDetectionPayload = {
  detections?: RawNativeDetection[];
  labels?: string[];
  error?: string;
};

export type NativeObjectDetection = {
  id: string;
  class: string;
  score: number;
  bbox: [number, number, number, number];
  bboxNormalized: boolean;
  worldPosition: {
    x: number;
    y: number;
    z: number;
  } | null;
  worldPositionAvailable: boolean;
  distanceMeters: number | null;
  source: string;
};

type UseNativeObjectDetectionOptions = {
  enabled: boolean;
  speakEnabled: boolean;
  minConfidence?: number;
  intervalMs?: number;
};

function normalizeDistanceMeters(input: unknown) {
  const value = Number(input);

  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
}

function formatDistanceMeters(distanceMeters: number) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return '';
  }

  return `${distanceMeters.toFixed(1)} meters`;
}

function uniqueLabels(labels: string[], detections: NativeObjectDetection[]) {
  const seen = new Set<string>();
  const values: string[] = [];

  labels.forEach((item) => {
    const label = String(item || '').trim().toLowerCase();

    if (!label || seen.has(label)) {
      return;
    }

    seen.add(label);
    values.push(label);
  });

  detections.forEach((detection) => {
    const label = String(detection.class || '').trim().toLowerCase();

    if (!label || seen.has(label)) {
      return;
    }

    seen.add(label);
    values.push(label);
  });

  return values.slice(0, 3);
}

function speechEntries(labels: string[], detections: NativeObjectDetection[]) {
  const seen = new Set<string>();
  const orderedDetections = [...detections].sort((a, b) => b.score - a.score);
  const entries: Array<{ label: string; distanceMeters: number | null }> = [];

  orderedDetections.forEach((detection) => {
    if (entries.length >= 3) {
      return;
    }

    const label = String(detection.class || '').trim().toLowerCase();

    if (!label || seen.has(label)) {
      return;
    }

    seen.add(label);
    entries.push({
      label,
      distanceMeters: normalizeDistanceMeters(detection.distanceMeters),
    });
  });

  if (!entries.length) {
    uniqueLabels(labels, detections).forEach((label) => {
      entries.push({ label, distanceMeters: null });
    });
  }

  return entries.slice(0, 3);
}

function normalizeWorldPosition(input: unknown) {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const point = input as RawWorldPosition;
  const x = Number(point.x);
  const y = Number(point.y);
  const z = Number(point.z);

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }

  return { x, y, z };
}

function normalizeBbox(value: unknown): [number, number, number, number] {
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

export function useNativeObjectDetection({
  enabled,
  speakEnabled,
  minConfidence = 0.55,
  intervalMs = 900,
}: UseNativeObjectDetectionOptions) {
  const [detections, setDetections] = useState<NativeObjectDetection[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastAnnouncement, setLastAnnouncement] = useState('');

  const detectionsRef = useRef<NativeObjectDetection[]>([]);
  const labelsRef = useRef<string[]>([]);
  const listenerRef = useRef<{ remove: () => Promise<void> } | null>(null);
  const lastSpokenAtRef = useRef(0);
  const lastSpokenKeyRef = useRef('');

  useEffect(() => {
    detectionsRef.current = detections;
  }, [detections]);

  useEffect(() => {
    labelsRef.current = labels;
  }, [labels]);

  const announce = useCallback((force = false) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      return false;
    }

    const entries = speechEntries(labelsRef.current, detectionsRef.current);

    if (!entries.length) {
      return false;
    }

    const now = Date.now();
    const key = entries
      .map((entry) => {
        const roundedDistance = entry.distanceMeters != null ? Math.round(entry.distanceMeters * 10) / 10 : 'na';
        return `${entry.label}:${roundedDistance}`;
      })
      .join('|');
    const elapsed = now - lastSpokenAtRef.current;

    if (!force) {
      if (elapsed < SPEECH_COOLDOWN_MS) {
        return false;
      }

      if (lastSpokenKeyRef.current === key && elapsed < SPEECH_REPEAT_WINDOW_MS) {
        return false;
      }
    }

    const phrase =
      entries.length > 1
        ? `I see ${entries
            .map((entry) =>
              entry.distanceMeters != null ? `${entry.label} at ${formatDistanceMeters(entry.distanceMeters)}` : entry.label,
            )
            .join(', ')}`
        : `I see ${
            entries[0].distanceMeters != null
              ? `${entries[0].label} at ${formatDistanceMeters(entries[0].distanceMeters)}`
              : entries[0].label
          }`;

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

  const applyPayload = useCallback((payload: NativeDetectionPayload | null | undefined) => {
    const nextDetections = Array.isArray(payload?.detections)
      ? payload.detections.map((detection, index) => ({
          id: String(detection.id || `native-detection-${Date.now()}-${index}`),
          class: String(detection.class || 'Object'),
          score: Number(detection.score || 0),
          bbox: normalizeBbox(detection.bbox),
          bboxNormalized: Boolean(detection.bboxNormalized),
          worldPosition: normalizeWorldPosition(detection.worldPosition),
          worldPositionAvailable: Boolean(detection.worldPositionAvailable),
          distanceMeters: normalizeDistanceMeters(detection.distanceMeters),
          source: String(detection.source || 'native-vision'),
        }))
      : [];

    setDetections(nextDetections);
    setLabels(Array.isArray(payload?.labels) ? payload.labels.map((label) => String(label)) : []);

    if (typeof payload?.error === 'string' && payload.error.trim()) {
      setError(payload.error);
      return;
    }

    setError('');
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function stopAndCleanup() {
      if (listenerRef.current) {
        try {
          await listenerRef.current.remove();
        } catch {
          // No-op during cleanup.
        }

        listenerRef.current = null;
      }

      try {
        await stopNativeObjectDetection();
      } catch {
        // No-op during cleanup.
      }
    }

    if (!enabled) {
      setDetections([]);
      setLabels([]);
      setError('');
      void stopAndCleanup();
      return;
    }

    async function start() {
      setLoading(true);
      setError('');

      try {
        listenerRef.current = await addNativeObjectDetectionListener((event) => {
          if (!cancelled) {
            applyPayload(event as NativeDetectionPayload);
          }
        });

        const started = await startNativeObjectDetection({
          minConfidence,
          intervalMs,
          qualityMode: 'accurate',
        });

        if (!cancelled) {
          applyPayload(started as NativeDetectionPayload);
        }

        const latest = await getNativeObjectDetectionStatus();

        if (!cancelled) {
          applyPayload(latest as NativeDetectionPayload);
        }
      } catch (detectorError) {
        if (!cancelled) {
          setError(detectorError instanceof Error ? detectorError.message : 'Failed to start native object detection.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void start();

    return () => {
      cancelled = true;
      void stopAndCleanup();
    };
  }, [applyPayload, enabled, intervalMs, minConfidence]);

  useEffect(() => {
    if (!enabled || !speakEnabled) {
      return;
    }

    announce(false);
  }, [announce, detections, enabled, labels, speakEnabled]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    detections,
    labels,
    loading,
    error,
    lastAnnouncement,
    announceNow: () => announce(true),
  };
}
