import type { RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

const SPEECH_COOLDOWN_MS = 5000;
const SPEECH_REPEAT_WINDOW_MS = 14000;

type TextBoundingBox = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

type TextDetection = {
  rawValue?: string;
  text?: string;
  boundingBox?: TextBoundingBox;
};

type TextDetectorInstance = {
  detect: (source: ImageBitmapSource) => Promise<TextDetection[]>;
};

type TextDetectorConstructor = new () => TextDetectorInstance;

type UseWebTextRecognitionOptions = {
  enabled: boolean;
  speakEnabled: boolean;
  intervalMs?: number;
  videoRef: RefObject<HTMLVideoElement | null>;
};

export type WebTextBlock = {
  id: string;
  text: string;
  bbox: [number, number, number, number];
  bboxNormalized: boolean;
  source: string;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function getTextDetectorConstructor(): TextDetectorConstructor | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const maybeDetector = (
    window as Window & typeof globalThis & {
      TextDetector?: TextDetectorConstructor;
    }
  ).TextDetector;

  return typeof maybeDetector === 'function' ? maybeDetector : null;
}

function supportsTextDetector() {
  return Boolean(getTextDetectorConstructor());
}

function sortBlocksInReadingOrder(blocks: WebTextBlock[]) {
  return [...blocks].sort((a, b) => {
    const aCenterY = a.bbox[1] + a.bbox[3] * 0.5;
    const bCenterY = b.bbox[1] + b.bbox[3] * 0.5;
    const lineTolerance = Math.max(a.bbox[3], b.bbox[3]) * 0.65;

    if (Math.abs(aCenterY - bCenterY) <= lineTolerance) {
      return a.bbox[0] - b.bbox[0];
    }

    return aCenterY - bCenterY;
  });
}

function buildSpeakableText(text: string, blocks: WebTextBlock[]) {
  const orderedBlocks = sortBlocksInReadingOrder(blocks);
  const linesFromBlocks = orderedBlocks
    .map((block) => block.text.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join('\n');

  const merged = linesFromBlocks || String(text || '').trim();

  return merged
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('. ');
}

export function useWebTextRecognition({
  enabled,
  speakEnabled,
  intervalMs = 1200,
  videoRef,
}: UseWebTextRecognitionOptions) {
  const [blocks, setBlocks] = useState<WebTextBlock[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastAnnouncement, setLastAnnouncement] = useState('');

  const detectorRef = useRef<TextDetectorInstance | null>(null);
  const busyRef = useRef(false);
  const blocksRef = useRef<WebTextBlock[]>([]);
  const textRef = useRef('');
  const lastSpokenAtRef = useRef(0);
  const lastSpokenKeyRef = useRef('');

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  const speakNowInternal = useCallback((force: boolean) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      return false;
    }

    const phrase = buildSpeakableText(textRef.current, blocksRef.current);

    if (!phrase) {
      return false;
    }

    const key = phrase.toLowerCase();
    const now = Date.now();
    const elapsed = now - lastSpokenAtRef.current;
    const synth = window.speechSynthesis;

    if (!force) {
      if (elapsed < SPEECH_COOLDOWN_MS) {
        return false;
      }

      if (key === lastSpokenKeyRef.current && elapsed < SPEECH_REPEAT_WINDOW_MS) {
        return false;
      }
    }

    const utterance = new SpeechSynthesisUtterance(phrase);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;

    if (force) {
      synth.cancel();
    } else if (synth.speaking) {
      return false;
    }

    synth.speak(utterance);
    lastSpokenAtRef.current = now;
    lastSpokenKeyRef.current = key;
    setLastAnnouncement(phrase);
    return true;
  }, []);

  const detectText = useCallback(async () => {
    if (busyRef.current || !enabled) {
      return;
    }

    const videoElement = videoRef.current;

    if (!videoElement) {
      return;
    }

    const width = Number(videoElement.videoWidth || 0);
    const height = Number(videoElement.videoHeight || 0);

    if (width < 32 || height < 24) {
      return;
    }

    if (!detectorRef.current) {
      const Detector = getTextDetectorConstructor();

      if (!Detector) {
        setError('Read mode is not supported in this browser.');
        return;
      }

      detectorRef.current = new Detector();
    }

    busyRef.current = true;

    let bitmap: ImageBitmap | null = null;

    try {
      bitmap = await createImageBitmap(videoElement);
      const detections = await detectorRef.current.detect(bitmap);

      const nextBlocks: WebTextBlock[] = [];

      (Array.isArray(detections) ? detections : []).forEach((detection, index) => {
        const value = String(detection?.rawValue || detection?.text || '').trim();

        if (!value) {
          return;
        }

        const rect = detection?.boundingBox || {};
        const left = clamp01(Number(rect.x || 0) / Math.max(1, width));
        const top = clamp01(Number(rect.y || 0) / Math.max(1, height));
        const boxWidth = clamp01(Number(rect.width || 0) / Math.max(1, width));
        const boxHeight = clamp01(Number(rect.height || 0) / Math.max(1, height));

        nextBlocks.push({
          id: `web-text-${Date.now()}-${index}`,
          text: value,
          bbox: [left, top, boxWidth, boxHeight],
          bboxNormalized: true,
          source: 'web-textdetector',
        });
      });

      const orderedBlocks = sortBlocksInReadingOrder(nextBlocks);
      const nextText = orderedBlocks
        .map((block) => block.text)
        .slice(0, 8)
        .join('\n');

      setBlocks(orderedBlocks);
      setText(nextText);
      setError('');
    } catch (recognitionError) {
      setError(
        recognitionError instanceof Error
          ? recognitionError.message
          : 'Failed to read text from camera.',
      );
    } finally {
      bitmap?.close();
      busyRef.current = false;
    }
  }, [enabled, videoRef]);

  useEffect(() => {
    if (!enabled) {
      setBlocks([]);
      setText('');
      setError('');
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError('');

    const timer = window.setInterval(() => {
      void detectText();
    }, Math.max(400, intervalMs));

    void detectText().finally(() => {
      setLoading(false);
    });

    return () => {
      window.clearInterval(timer);
      busyRef.current = false;
      setLoading(false);
    };
  }, [detectText, enabled, intervalMs]);

  useEffect(() => {
    if (!enabled || !speakEnabled) {
      return;
    }

    speakNowInternal(false);
  }, [blocks, enabled, speakEnabled, speakNowInternal, text]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    blocks,
    text,
    loading,
    error,
    lastAnnouncement,
    supported: supportsTextDetector(),
    speakNow: () => speakNowInternal(true),
  };
}
