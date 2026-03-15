import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import BottomNav from '../components/navigation/BottomNav';
import ModelViewport, {
  type ModelViewportApi,
  type ModelViewportDisplayMode,
  type ModelViewportInteractionMode,
  type ModelViewportMeasurement,
} from '../components/viewer/ModelViewport';
import {
  type ScanAnnotation,
  type ScanRecord,
  getScanById,
  saveScanAnnotations,
} from '../services/scanService';

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

function interactionHint(mode: ModelViewportInteractionMode) {
  if (mode === 'measure') {
    return 'Measure mode: tap 2 points on the model to calculate distance.';
  }

  if (mode === 'annotate') {
    return 'Annotate mode: tap the model to place a note marker.';
  }

  if (mode === 'edit') {
    return 'Edit mode: tap a mesh to select it, then use mesh actions.';
  }

  return 'Navigate mode: orbit, pan, and zoom the model.';
}

function toolbarButtonClasses(active: boolean) {
  if (active) {
    return 'flex flex-col items-center justify-center gap-1 flex-1 rounded-lg border border-primary/30 bg-primary/10 py-1 text-primary transition-colors';
  }

  return 'group flex flex-1 flex-col items-center justify-center gap-1 rounded-lg py-1 transition-colors hover:bg-slate-800';
}

function renderMeasurementRange(measurement: ModelViewportMeasurement | null) {
  if (!measurement) {
    return '--';
  }

  return `${Number(measurement.distanceFeet || 0).toFixed(2)} ft`;
}

type AnnotationUpdater = ScanAnnotation[] | ((previous: ScanAnnotation[]) => ScanAnnotation[]);

export default function ModelViewerPage() {
  const { scanId } = useParams();
  const [searchParams] = useSearchParams();
  const [scan, setScan] = useState<ScanRecord | null>(null);
  const [scanLoading, setScanLoading] = useState(true);
  const [scanError, setScanError] = useState('');
  const [viewMode, setViewMode] = useState<ModelViewportDisplayMode>('textured');
  const [uvTextureEnabled, setUvTextureEnabled] = useState(false);
  const [interactionMode, setInteractionMode] = useState<ModelViewportInteractionMode>(
    searchParams.get('mode') === 'edit' ? 'edit' : 'navigate',
  );
  const [measureInfo, setMeasureInfo] = useState<ModelViewportMeasurement | null>(null);
  const [annotations, setAnnotations] = useState<ScanAnnotation[]>([]);
  const [selectedMeshLabel, setSelectedMeshLabel] = useState('');
  const [editStatus, setEditStatus] = useState('');
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

  useEffect(() => {
    setAnnotations(Array.isArray(scan?.annotations) ? scan.annotations : []);
  }, [scan?.annotations, scan?.id]);

  const persistAnnotations = useCallback(
    async (nextAnnotations: ScanAnnotation[]) => {
      if (!scan?.id) {
        return;
      }

      try {
        const updatedScan = await saveScanAnnotations(scan.id, nextAnnotations);

        if (!updatedScan) {
          return;
        }

        setScan((current) => {
          if (!current || current.id !== updatedScan.id) {
            return current;
          }

          return updatedScan;
        });
      } catch {
        setEditStatus('Failed to save annotation changes.');
      }
    },
    [scan?.id],
  );

  const updateAnnotations = useCallback(
    (updater: AnnotationUpdater) => {
      setAnnotations((previous) => {
        const next = typeof updater === 'function' ? updater(previous) : updater;
        void persistAnnotations(next);
        return next;
      });
    },
    [persistAnnotations],
  );

  const handleViewerReady = useCallback((api: ModelViewportApi | null) => {
    viewerControlsRef.current = api;
  }, []);

  const toggleInteractionMode = useCallback((mode: ModelViewportInteractionMode) => {
    setEditStatus('');
    setInteractionMode((previous) => (previous === mode ? 'navigate' : mode));
  }, []);

  const handleMeasureChange = useCallback((nextMeasurement: ModelViewportMeasurement | null) => {
    setMeasureInfo(nextMeasurement);
  }, []);

  const handleAddAnnotation = useCallback(
    (annotation: ScanAnnotation) => {
      setEditStatus('');
      updateAnnotations((previous) => [...previous, annotation]);
    },
    [updateAnnotations],
  );

  const handleSelectionChange = useCallback((label: string) => {
    setSelectedMeshLabel(label || '');
  }, []);

  const clearMeasurement = useCallback(() => {
    viewerControlsRef.current?.clearMeasurements();
    setMeasureInfo(null);
  }, []);

  const clearAllAnnotations = useCallback(() => {
    setEditStatus('');
    updateAnnotations([]);
  }, [updateAnnotations]);

  const updateAnnotationText = useCallback(
    (annotationId: string, text: string) => {
      setEditStatus('');
      updateAnnotations((previous) =>
        previous.map((annotation) =>
          annotation.id === annotationId
            ? {
                ...annotation,
                text,
              }
            : annotation,
        ),
      );
    },
    [updateAnnotations],
  );

  const deleteAnnotation = useCallback(
    (annotationId: string) => {
      setEditStatus('');
      updateAnnotations((previous) => previous.filter((annotation) => annotation.id !== annotationId));
    },
    [updateAnnotations],
  );

  const hideSelectedMesh = useCallback(() => {
    const didHide = viewerControlsRef.current?.hideSelectedMesh();

    if (didHide) {
      setEditStatus('Selected mesh hidden.');
      return;
    }

    setEditStatus('Select a mesh first.');
  }, []);

  const undoMeshEdit = useCallback(() => {
    const didRestore = viewerControlsRef.current?.undoMeshEdit();

    if (didRestore) {
      setEditStatus('Last hidden mesh restored.');
      return;
    }

    setEditStatus('No mesh edits to undo.');
  }, []);

  const showAllMeshes = useCallback(() => {
    viewerControlsRef.current?.showAllMeshes();
    setEditStatus('All meshes are now visible.');
  }, []);

  const title = scan?.title || 'Captured Scan';
  const capturedAt = scan?.capturedAt || 'Recently captured';
  const vertices = Number(scan?.vertexCount || 0);
  const faces = Number(scan?.faceCount || 0);
  const points = Number(scan?.pointsCaptured || 0);
  const interactionActive = interactionMode !== 'navigate';
  const recentAnnotations = useMemo(() => annotations.slice(-3).reverse(), [annotations]);

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-background-dark font-display text-slate-100">
      <header className="safe-area-top safe-area-x z-20 flex items-center justify-between border-b border-slate-800 bg-background-dark/80 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Link
            to="/library"
            className="flex items-center justify-center rounded-lg p-2 transition-colors hover:bg-slate-800"
          >
            <span className="material-symbols-outlined text-slate-100">arrow_back</span>
          </Link>
          <div>
            <h1 className="text-base font-bold leading-tight text-slate-100">{title}</h1>
            <p className="text-xs text-slate-400">Captured {capturedAt}</p>
          </div>
        </div>

        <Link
          to={`/preview/${scan?.id || 'latest'}`}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
        >
          Save
        </Link>
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

      <main className="relative flex-1 overflow-hidden bg-slate-900">
        <ModelViewport
          modelUrl={scan?.modelUrl}
          modelFormat={scan?.modelFormat}
          viewMode={viewMode}
          uvTextureEnabled={uvTextureEnabled}
          interactionMode={interactionMode}
          annotations={annotations}
          onAddAnnotation={handleAddAnnotation}
          onMeasureChange={handleMeasureChange}
          onSelectionChange={handleSelectionChange}
          onViewerReady={handleViewerReady}
        />

        {interactionActive ? (
          <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full border border-primary/30 bg-background-dark/80 px-4 py-1.5 text-[11px] font-medium text-slate-200 backdrop-blur-md">
            {interactionHint(interactionMode)}
          </div>
        ) : null}

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

        {interactionActive ? (
          <section className="absolute bottom-24 left-4 z-10 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-primary/30 bg-background-dark/90 p-3 shadow-2xl backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">Interaction</p>
              <button
                type="button"
                onClick={() => setInteractionMode('navigate')}
                className="rounded border border-slate-700 px-2 py-1 text-[10px] font-semibold text-slate-300 hover:border-primary/50 hover:text-primary"
              >
                Close
              </button>
            </div>

            {interactionMode === 'measure' ? (
              <div className="space-y-2">
                <div className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">Last Measure</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">{renderMeasurementRange(measureInfo)}</p>
                  {measureInfo ? (
                    <p
                      className={`mt-1 text-[11px] ${
                        measureInfo.withinRange ? 'text-emerald-300' : 'text-amber-300'
                      }`}
                    >
                      {measureInfo.withinRange
                        ? `Within range (${measureInfo.minFeet}-${measureInfo.maxFeet} ft).`
                        : `Out of range (${measureInfo.minFeet}-${measureInfo.maxFeet} ft).`}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-400">Tap two points to measure distance.</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={clearMeasurement}
                  className="w-full rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-primary/50 hover:text-primary"
                >
                  Clear Measurement
                </button>
              </div>
            ) : null}

            {interactionMode === 'annotate' ? (
              <div className="space-y-2">
                {recentAnnotations.length === 0 ? (
                  <p className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-[11px] text-slate-400">
                    Tap on the model to place annotations.
                  </p>
                ) : (
                  recentAnnotations.map((annotation) => (
                    <div
                      key={annotation.id}
                      className="rounded-lg border border-slate-700 bg-slate-900/70 p-2"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={annotation.text}
                          onChange={(event) => updateAnnotationText(annotation.id, event.target.value)}
                          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none focus:border-primary"
                        />
                        <button
                          type="button"
                          onClick={() => deleteAnnotation(annotation.id)}
                          className="rounded border border-rose-400/40 px-2 py-1 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/20"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
                <button
                  type="button"
                  onClick={clearAllAnnotations}
                  className="w-full rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-primary/50 hover:text-primary"
                >
                  Clear Annotations
                </button>
              </div>
            ) : null}

            {interactionMode === 'edit' ? (
              <div className="space-y-2">
                <div className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">Selected Mesh</p>
                  <p className="mt-1 text-xs font-semibold text-slate-100">{selectedMeshLabel || 'None selected'}</p>
                  {editStatus ? <p className="mt-1 text-[11px] text-primary">{editStatus}</p> : null}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={hideSelectedMesh}
                    className="rounded-lg border border-slate-700 px-2 py-2 text-[11px] font-semibold text-slate-200 hover:border-primary/50 hover:text-primary"
                  >
                    Hide
                  </button>
                  <button
                    type="button"
                    onClick={undoMeshEdit}
                    className="rounded-lg border border-slate-700 px-2 py-2 text-[11px] font-semibold text-slate-200 hover:border-primary/50 hover:text-primary"
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    onClick={showAllMeshes}
                    className="rounded-lg border border-slate-700 px-2 py-2 text-[11px] font-semibold text-slate-200 hover:border-primary/50 hover:text-primary"
                  >
                    Show All
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </main>

      <nav className="safe-area-x border-t border-slate-800 bg-background-dark px-4 py-3 z-20">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => toggleInteractionMode('measure')}
            className={toolbarButtonClasses(interactionMode === 'measure')}
          >
            <span
              className={`material-symbols-outlined transition-colors ${
                interactionMode === 'measure' ? 'text-primary' : 'text-slate-400 group-hover:text-primary'
              }`}
            >
              straighten
            </span>
            <span
              className={`text-[10px] font-medium transition-colors ${
                interactionMode === 'measure' ? 'text-primary' : 'text-slate-400 group-hover:text-slate-200'
              }`}
            >
              Measure
            </span>
          </button>
          <button
            type="button"
            onClick={() => toggleInteractionMode('annotate')}
            className={toolbarButtonClasses(interactionMode === 'annotate')}
          >
            <span
              className={`material-symbols-outlined transition-colors ${
                interactionMode === 'annotate' ? 'text-primary' : 'text-slate-400 group-hover:text-primary'
              }`}
            >
              sticky_note_2
            </span>
            <span
              className={`text-[10px] font-medium transition-colors ${
                interactionMode === 'annotate' ? 'text-primary' : 'text-slate-400 group-hover:text-slate-200'
              }`}
            >
              Annotate
            </span>
          </button>
          <button
            type="button"
            onClick={() => toggleInteractionMode('edit')}
            className={toolbarButtonClasses(interactionMode === 'edit')}
          >
            <span
              className={`material-symbols-outlined transition-colors ${
                interactionMode === 'edit' ? 'text-primary' : 'text-slate-400 group-hover:text-primary'
              }`}
            >
              polyline
            </span>
            <span
              className={`text-[10px] font-medium transition-colors ${
                interactionMode === 'edit' ? 'text-primary' : 'text-slate-400 group-hover:text-slate-200'
              }`}
            >
              Edit Mesh
            </span>
          </button>
        </div>
      </nav>

      <BottomNav />
    </div>
  );
}
