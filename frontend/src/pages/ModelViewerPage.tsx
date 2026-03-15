import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import BottomNav from '../components/navigation/BottomNav';
import ModelViewport, {
  type ModelViewportApi,
  type ModelViewportDisplayMode,
} from '../components/viewer/ModelViewport';
import { type ScanRecord, getScanById } from '../services/scanService';

const VIEW_MODES: ModelViewportDisplayMode[] = ['point-cloud', 'wireframe', 'textured', 'outline'];

function buttonLabel(mode: ModelViewportDisplayMode) {
  if (mode === 'point-cloud') {
    return 'Point Cloud';
  }

  if (mode === 'wireframe') {
    return 'Wireframe';
  }

  if (mode === 'outline') {
    return 'Outline';
  }

  return 'Textured';
}

export default function ModelViewerPage() {
  const { scanId } = useParams();
  const [scan, setScan] = useState<ScanRecord | null>(null);
  const [scanLoading, setScanLoading] = useState(true);
  const [scanError, setScanError] = useState('');
  const [viewMode, setViewMode] = useState<ModelViewportDisplayMode>('textured');
  const [uvTextureEnabled, setUvTextureEnabled] = useState(false);
  const viewerControlsRef = useRef<ModelViewportApi | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setScanLoading(true);
      setScanError('');

      if (!scanId) {
        if (active) {
          setScan(null);
          setScanError('Scan id is missing.');
          setScanLoading(false);
        }
        return;
      }

      try {
        const loaded = await getScanById(scanId);

        if (!active) {
          return;
        }

        if (!loaded) {
          setScan(null);
          setScanError('Scan not found.');
        } else {
          setScan(loaded);
        }
      } catch {
        if (!active) {
          return;
        }

        setScan(null);
        setScanError('Unable to load scan right now.');
      } finally {
        if (active) {
          setScanLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [scanId]);

  const handleViewerReady = useCallback((api: ModelViewportApi | null) => {
    viewerControlsRef.current = api;
  }, []);

  const title = scan?.title || 'Captured Scan';
  const capturedAt = scan?.capturedAt || 'Recently captured';
  const vertices = Number(scan?.vertexCount || 0);
  const faces = Number(scan?.faceCount || 0);
  const points = Number(scan?.pointsCaptured || 0);

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-background-dark font-display text-slate-100">
      <header className="safe-area-top safe-area-x z-20 flex items-center justify-between border-b border-slate-800 bg-background-dark/80 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Link to="/library" className="flex items-center justify-center rounded-lg p-2 transition-colors hover:bg-slate-800">
            <span className="material-symbols-outlined text-slate-100">arrow_back</span>
          </Link>
          <div>
            <h1 className="text-base font-bold leading-tight text-slate-100">{title}</h1>
            <p className="text-xs text-slate-400">Captured {capturedAt}</p>
          </div>
        </div>
      </header>

      {scanLoading ? (
        <div className="mx-4 mt-3 rounded-lg border border-slate-700 bg-slate-900/70 px-4 py-2 text-xs text-slate-300">
          Loading model...
        </div>
      ) : null}

      {!scanLoading && scanError ? (
        <div className="mx-4 mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
          {scanError}
        </div>
      ) : null}

      <main className="relative flex-1 overflow-hidden bg-slate-900" aria-labelledby="viewer-screen-title">
        <h1 id="viewer-screen-title" className="sr-only">
          Model Viewer
        </h1>

        <ModelViewport
          modelUrl={scan?.modelUrl}
          modelFormat={scan?.modelFormat}
          viewMode={viewMode}
          uvTextureEnabled={uvTextureEnabled}
          onViewerReady={handleViewerReady}
        />

        <div className="absolute left-4 top-4 z-10 flex flex-col gap-2">
          <div className="rounded-lg border border-slate-700 bg-background-dark/80 p-1 shadow-xl backdrop-blur-md">
            <button
              type="button"
              onClick={() => viewerControlsRef.current?.resetView()}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800"
              title="Reset View"
            >
              <span className="material-symbols-outlined">restart_alt</span>
            </button>
          </div>
        </div>

        <div className="absolute bottom-24 left-1/2 z-10 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-background-dark/90 p-1 shadow-2xl backdrop-blur-md">
            {VIEW_MODES.map((mode) => {
              const active = viewMode === mode;

              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                    active ? 'bg-primary text-white shadow-lg' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {buttonLabel(mode)}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setUvTextureEnabled((current) => !current)}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                uvTextureEnabled
                  ? 'border-primary/60 bg-primary/20 text-primary'
                  : 'border-slate-700 text-slate-300 hover:border-primary/50'
              }`}
            >
              UV {uvTextureEnabled ? 'On' : 'Off'}
            </button>
          </div>
        </div>

        <aside className="pointer-events-none absolute bottom-24 right-4 top-16 z-10 w-56">
          <div className="pointer-events-none flex flex-col gap-4">
            <details
              className="pointer-events-auto group overflow-hidden rounded-xl border border-slate-700 bg-background-dark/90 shadow-xl backdrop-blur-md"
              open
            >
              <summary className="flex cursor-pointer list-none items-center justify-between p-2.5 transition-colors hover:bg-slate-800/50">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <span className="material-symbols-outlined text-xs text-primary">info</span>
                  Model Details
                </span>
                <span className="material-symbols-outlined text-slate-400 transition-transform group-open:rotate-180">
                  expand_more
                </span>
              </summary>
              <div className="space-y-2.5 p-3 pt-0">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Triangles</span>
                  <span className="font-mono text-slate-100">{faces ? faces.toLocaleString() : '--'}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Vertices</span>
                  <span className="font-mono text-slate-100">{vertices ? vertices.toLocaleString() : '--'}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Points</span>
                  <span className="font-mono text-slate-100">{points ? points.toLocaleString() : '--'}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Engine</span>
                  <span className="font-mono text-slate-100">{scan?.arEngine || 'Unknown'}</span>
                </div>
              </div>
            </details>
          </div>
        </aside>
      </main>

      <BottomNav fixed />
    </div>
  );
}
