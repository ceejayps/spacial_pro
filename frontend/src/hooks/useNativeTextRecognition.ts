import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addNativeTextRecognitionListener,
  getNativeTextRecognitionStatus,
  startNativeTextRecognition,
  stopNativeTextRecognition,
} from '../services/scannerService';

const SPEECH_COOLDOWN_MS = 5000;
const SPEECH_REPEAT_WINDOW_MS = 14000;

type NativeTextRecognitionOptions = {
  enabled: boolean;
  speakEnabled: boolean;
  intervalMs?: number;
};

type RawNativeTextBlock = {
  id?: string;
  text?: string;
  bbox?: number[];
  bboxNormalized?: boolean;
  source?: string;
};

type NativeTextRecognitionPayload = {
  blocks?: RawNativeTextBlock[];
  text?: string;
  error?: string;
};

export type RecognizedTextBlock = {
  id: string;
  text: string;
  bbox: [number, number, number, number];
  bboxNormalized: boolean;
  source: string;
};

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

function sortBlocksInReadingOrder(blocks: RecognizedTextBlock[]) {
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

function normalizeBlock(block: RawNativeTextBlock, index: number): RecognizedTextBlock {
  return {
    id: String(block.id || `native-text-${Date.now()}-${index}`),
    text: String(block.text || '').trim(),
    bbox: normalizeBbox(block.bbox),
    bboxNormalized: Boolean(block.bboxNormalized),
    source: String(block.source || 'native-text'),
  };
}

function buildSpeakableText(text: string, blocks: RecognizedTextBlock[]) {
  const orderedBlocks = sortBlocksInReadingOrder(blocks);
  const fromBlocks = orderedBlocks
    .map((block) => String(block.text || '').trim())
    .filter(Boolean)
    .slice(0, 8)
    .join('\n');

  const merged = fromBlocks || String(text || '').trim();

  return merged
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('. ');
}

export function useNativeTextRecognition({
  enabled,
  speakEnabled,
  intervalMs = 1100,
}: NativeTextRecognitionOptions) {
  const [blocks, setBlocks] = useState<RecognizedTextBlock[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastAnnouncement, setLastAnnouncement] = useState('');

  const blocksRef = useRef<RecognizedTextBlock[]>([]);
  const textRef = useRef('');
  const listenerRef = useRef<{ remove: () => Promise<void> } | null>(null);
  const lastSpokenAtRef = useRef(0);
  const lastSpokenKeyRef = useRef('');

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  const speakNowInternal = useCallback((force = false) => {
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

  const applyPayload = useCallback((payload: NativeTextRecognitionPayload | null | undefined) => {
    const parsedBlocks = Array.isArray(payload?.blocks)
      ? payload.blocks
          .map((block, index) => normalizeBlock(block, index))
          .filter((block) => block.text)
      : [];
    const nextBlocks = sortBlocksInReadingOrder(parsedBlocks);
    const nextText = nextBlocks.map((block) => block.text).join('\n') || String(payload?.text || '').trim();

    setBlocks(nextBlocks);
    setText(nextText);

    if (typeof payload?.error === 'string' && payload.error.trim()) {
      setError(payload.error);
      return;
    }

    setError('');
  }, []);

  useEffect(() => {
    let cancelled = false;

    const cleanup = async () => {
      if (listenerRef.current) {
        try {
          await listenerRef.current.remove();
        } catch {
          // no-op
        }

        listenerRef.current = null;
      }

      try {
        await stopNativeTextRecognition();
      } catch {
        // no-op
      }
    };

    if (!enabled) {
      setBlocks([]);
      setText('');
      setError('');
      setLastAnnouncement('');
      void cleanup();
      return;
    }

    const start = async () => {
      setLoading(true);
      setError('');

      try {
        listenerRef.current = await addNativeTextRecognitionListener((event: unknown) => {
          if (!cancelled) {
            applyPayload(event as NativeTextRecognitionPayload);
          }
        });

        const started = await startNativeTextRecognition({
          intervalMs,
        });

        if (!cancelled) {
          applyPayload(started as NativeTextRecognitionPayload);
        }

        const latest = await getNativeTextRecognitionStatus();

        if (!cancelled) {
          applyPayload(latest as NativeTextRecognitionPayload);
        }
      } catch (recognitionError) {
        if (!cancelled) {
          setError(
            recognitionError instanceof Error
              ? recognitionError.message
              : 'Failed to start native text recognition.',
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      void cleanup();
    };
  }, [applyPayload, enabled, intervalMs]);

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
    speakNow: () => speakNowInternal(true),
  };
}
