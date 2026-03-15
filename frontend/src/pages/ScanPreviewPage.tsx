import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { type ScanRecord, getScanById, listAllScans } from '../services/scanService';

const FALLBACK_PREVIEW_IMAGE =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuB7woHorZKBaSFdvnmzJqPM2W82NorwWmAIxxPr0O7j049Q7QzGvUcgws7EquC31AtCxLkzbGhRNLQdHLUjrmz2KzxMgD-VUm3riMIdasZ-g6QQNvNmXL5gKTHqtIFRlZ3DacLzu5cukwP3iyLrZj9Pb1htrjyMYj5b8pXTm_iG6lav3w3DIpYyKl-4of7imXz8Bmr0ov3y3HpYpVwr4A4ptiSeQPyUVW1WluTu8yQCWOFM34qsXAax3MA2CdAlO4FhyfKEuID9zw';

const FALLBACK_SCAN: ScanRecord = {
  id: 'fallback-scan',
  title: 'Living Room',
  capturedAt: 'Mar 8, 2026',
  capturedAtIso: '2026-03-08T12:00:00.000Z',
  status: 'processed',
  progress: 100,
  sizeLabel: '24 MB',
  sizeBytes: 24 * 1024 * 1024,
  thumbnail: FALLBACK_PREVIEW_IMAGE,
  modelUrl: '',
  fileDownloadUrl: '',
  modelPath: '',
  modelFormat: 'glb',
  vertexCount: 0,
  faceCount: 0,
  pointsCaptured: 12_500_000,
  scanQuality: 92,
  estimatedAccuracyMm: 6,
  arEngine: 'ARKit',
  source: 'device',
  storageLocation: 'device',
  syncState: 'local',
  cloudModelUrl: '',
  cloudSyncedAt: '',
  annotations: [],
  createdAt: '2026-03-08T12:00:00.000Z',
  updatedAt: '2026-03-08T12:00:00.000Z',
  originalFilename: 'living-room.glb',
  contentType: 'model/gltf-binary',
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function touchDistance(
  touches: {
    length: number;
    [index: number]: {
      clientX: number;
      clientY: number;
    };
  },
) {
  const first = touches[0];
  const second = touches[1];
  const dx = first.clientX - second.clientX;
  const dy = first.clientY - second.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function formatPoints(pointsCaptured: number) {
  const points = Number(pointsCaptured || 0);

  if (points >= 1_000_000) {
    return `${(points / 1_000_000).toFixed(1)}M points`;
  }

  if (points >= 1_000) {
    return `${(points / 1_000).toFixed(1)}K points`;
  }

  return `${points} points`;
}

export default function ScanPreviewPage() {
  const { scanId } = useParams();
  const [zoom, setZoom] = useState(1);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pinchStartDistanceRef = useRef(0);
  const pinchStartZoomRef = useRef(1);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError('');

      try {
        const allScans = await listAllScans();
        let nextScans = Array.isArray(allScans) ? allScans : [];

        if (scanId && !nextScans.some((item) => item.id === scanId || item.remoteId === scanId)) {
          const selected = await getScanById(scanId);

          if (selected) {
            nextScans = [selected, ...nextScans];
          }
        }

        if (!nextScans.length) {
          nextScans = [FALLBACK_SCAN];
        }

        if (!active) {
          return;
        }

        setScans(nextScans);
      } catch {
        if (!active) {
          return;
        }

        setScans([FALLBACK_SCAN]);
        setError('Unable to load scan preview right now.');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [scanId]);

  const scan = useMemo(() => {
    if (!scans.length) {
      return FALLBACK_SCAN;
    }

    return scans.find((item) => item.id === scanId || item.remoteId === scanId) || scans[0] || FALLBACK_SCAN;
  }, [scanId, scans]);

  const activeId = scan.id;
  const activeIndex = scans.findIndex((item) => item.id === activeId || item.remoteId === activeId);
  const newerScan = activeIndex > 0 ? scans[activeIndex - 1] : null;
  const olderScan = activeIndex >= 0 && activeIndex < scans.length - 1 ? scans[activeIndex + 1] : null;
  const previewImage = scan.thumbnail || FALLBACK_PREVIEW_IMAGE;
  const viewerTarget = scan.remoteId || scan.id;

  function zoomIn() {
    setZoom((current) => clamp(current + 0.2, 1, 4));
  }

  function zoomOut() {
    setZoom((current) => clamp(current - 0.2, 1, 4));
  }

  function resetZoom() {
    setZoom(1);
  }

  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 2) {
      return;
    }

    pinchStartDistanceRef.current = touchDistance(event.touches);
    pinchStartZoomRef.current = zoom;
  }

  function handleTouchMove(event: React.TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 2 || pinchStartDistanceRef.current <= 0) {
      return;
    }

    const ratio = touchDistance(event.touches) / pinchStartDistanceRef.current;
    setZoom(clamp(pinchStartZoomRef.current * ratio, 1, 4));
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    if (event.touches.length < 2) {
      pinchStartDistanceRef.current = 0;
      pinchStartZoomRef.current = zoom;
    }
  }

  return (
    <div className="min-h-screen bg-background-light text-slate-900 dark:bg-background-dark dark:text-slate-100">
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-8 pt-4" aria-labelledby="preview-screen-title">
        <header className="mb-4 flex items-center justify-between gap-3">
          <Link
            to="/scan"
            className="inline-flex h-11 min-w-[88px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            Back
          </Link>

          <h1 id="preview-screen-title" className="text-center text-xl font-bold tracking-tight">
            Scan Preview
          </h1>

          <button
            type="button"
            className="inline-flex h-11 min-w-[88px] items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
          >
            Share
          </button>
        </header>

        {loading ? (
          <div className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            Loading preview...
          </div>
        ) : null}

        {!loading && error ? (
          <div className="mb-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        <section className="relative mb-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-slate-900">
          <div
            className="relative h-[64vh] min-h-[360px] overflow-hidden rounded-2xl bg-[linear-gradient(120deg,#1d2d42,#111927)]"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <div
              className="absolute inset-[18px] rounded-xl bg-cover bg-center transition-transform duration-150"
              style={{
                backgroundImage: `url("${previewImage}")`,
                transform: `scale(${zoom})`,
                transformOrigin: 'center center',
              }}
              aria-label="Scan preview image"
            />

            <div className="absolute right-6 top-6 grid gap-2">
              <button
                type="button"
                onClick={zoomIn}
                className="inline-flex h-11 min-w-[52px] items-center justify-center rounded-xl border border-slate-700/80 bg-slate-950/65 px-4 text-base font-semibold text-white backdrop-blur hover:bg-slate-900/80"
              >
                +
              </button>
              <button
                type="button"
                onClick={zoomOut}
                className="inline-flex h-11 min-w-[52px] items-center justify-center rounded-xl border border-slate-700/80 bg-slate-950/65 px-4 text-base font-semibold text-white backdrop-blur hover:bg-slate-900/80"
              >
                -
              </button>
              <button
                type="button"
                onClick={resetZoom}
                className="inline-flex h-11 min-w-[52px] items-center justify-center rounded-xl border border-slate-700/80 bg-slate-950/65 px-4 text-sm font-semibold text-white backdrop-blur hover:bg-slate-900/80"
              >
                Reset
              </button>
            </div>

            <div className="absolute left-6 bottom-6">
              <span className="inline-flex items-center rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-primary/30">
                Zoom {zoom.toFixed(1)}x
              </span>
            </div>
          </div>
        </section>

        <section className="mb-5 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <strong className="block text-sm font-semibold text-slate-900 dark:text-slate-100">Model</strong>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{scan.title}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <strong className="block text-sm font-semibold text-slate-900 dark:text-slate-100">Captured</strong>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{scan.capturedAt || FALLBACK_SCAN.capturedAt}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <strong className="block text-sm font-semibold text-slate-900 dark:text-slate-100">Point Cloud</strong>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{formatPoints(scan.pointsCaptured || FALLBACK_SCAN.pointsCaptured)}</p>
          </div>
        </section>

        <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Link
            to="/scan"
            className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            Retake
          </Link>
          <Link
            to={`/viewer/${viewerTarget}`}
            className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            Edit
          </Link>
          <Link
            to="/library"
            className="inline-flex min-h-[52px] items-center justify-center rounded-2xl bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
          >
            Save
          </Link>
          <Link
            to="/library"
            className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            Library
          </Link>
        </section>

        <section className="mb-5 flex flex-wrap gap-3">
          {newerScan ? (
            <Link
              to={`/preview/${newerScan.id}`}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Newer Scan
            </Link>
          ) : null}
          {olderScan ? (
            <Link
              to={`/preview/${olderScan.id}`}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Older Scan
            </Link>
          ) : null}
        </section>

        {scans.length > 1 ? (
          <section className="flex gap-3 overflow-x-auto pb-2">
            {scans.map((item) => {
              const selected = item.id === activeId;

              return (
                <Link
                  key={item.id}
                  to={`/preview/${item.id}`}
                  className={`min-w-[180px] rounded-2xl border p-3 transition-colors ${
                    selected
                      ? 'border-primary bg-primary/10'
                      : 'border-slate-200 bg-white hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800'
                  }`}
                >
                  <div
                    className="aspect-[16/10] rounded-xl bg-cover bg-center"
                    style={{ backgroundImage: `url("${item.thumbnail || FALLBACK_PREVIEW_IMAGE}")` }}
                  />
                  <p className="mt-3 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{item.title}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.capturedAt}</p>
                </Link>
              );
            })}
          </section>
        ) : null}
      </main>
    </div>
  );
}
