import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { ScanAnnotation } from '../../services/scanService';

export type ModelViewportDisplayMode = 'point-cloud' | 'wireframe' | 'textured' | 'outline';
export type ModelViewportInteractionMode = 'navigate' | 'measure' | 'annotate' | 'edit';

type ViewerPoint = {
  x: number;
  y: number;
  z: number;
};

export type ModelViewportMeasurement = {
  distanceMeters: number;
  distanceFeet: number;
  label: string;
  minFeet: number;
  maxFeet: number;
  withinRange: boolean;
  points: [ViewerPoint, ViewerPoint];
};

export type ModelViewportApi = {
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  clearMeasurements: () => void;
  hideSelectedMesh: () => boolean;
  undoMeshEdit: () => boolean;
  showAllMeshes: () => void;
};

type ModelViewportProps = {
  modelUrl?: string | null;
  modelUrlCandidates?: string[];
  modelFormat?: string | null;
  viewMode?: ModelViewportDisplayMode;
  uvTextureEnabled?: boolean;
  interactionMode?: ModelViewportInteractionMode;
  annotations?: ScanAnnotation[];
  onAddAnnotation?: (annotation: ScanAnnotation) => void;
  onMeasureChange?: (measurement: ModelViewportMeasurement | null) => void;
  onSelectionChange?: (label: string) => void;
  onViewerReady?: (api: ModelViewportApi | null) => void;
};

type MeshLike = THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;

type ViewerRuntime = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  measurementGroup: THREE.Group;
  annotationGroup: THREE.Group;
  hiddenMeshStack: MeshLike[];
  meshLabelCount: number;
};

type MaterialWithMap = THREE.Material & {
  map: THREE.Texture | null;
  needsUpdate: boolean;
  userData: Record<string, unknown>;
};

type MaterialWithEmissive = THREE.Material & {
  emissive: THREE.Color;
  emissiveIntensity: number;
};

function isMesh(node: THREE.Object3D | null | undefined): node is MeshLike {
  return Boolean(node && (node as MeshLike).isMesh);
}

function asMaterialArray(material: THREE.Material | THREE.Material[] | null | undefined) {
  if (Array.isArray(material)) {
    return material;
  }

  if (!material) {
    return [];
  }

  return [material];
}

function hasMapProperty(material: THREE.Material): material is MaterialWithMap {
  return Object.prototype.hasOwnProperty.call(material, 'map');
}

function hasEmissive(material: THREE.Material): material is MaterialWithEmissive {
  return 'emissive' in material && (material as MaterialWithEmissive).emissive instanceof THREE.Color;
}

function applyUvTextureForMesh(mesh: MeshLike, enabled: boolean) {
  asMaterialArray(mesh.material).forEach((material) => {
    if (!hasMapProperty(material)) {
      return;
    }

    if (!material.userData.__originalUvMapStored) {
      material.userData.__originalUvMap = material.map || null;
      material.userData.__originalUvMapStored = true;
    }

    material.map = enabled ? (material.userData.__originalUvMap as THREE.Texture | null) || null : null;
    material.needsUpdate = true;
  });
}

function disposeObject3D(object: THREE.Object3D) {
  object.traverse((node) => {
    const geometry = (node as THREE.Mesh).geometry;
    const material = (node as THREE.Mesh).material;

    geometry?.dispose?.();

    asMaterialArray(material).forEach((entry) => {
      entry?.dispose?.();
    });
  });
}

function setModeForMesh(mesh: MeshLike, mode: ModelViewportDisplayMode) {
  const activeMode = mode === 'point-cloud' ? 'wireframe' : mode;

  asMaterialArray(mesh.material).forEach((material) => {
    if ('wireframe' in material) {
      (material as THREE.Material & { wireframe?: boolean }).wireframe = activeMode === 'wireframe';
    }

    material.transparent = activeMode === 'outline';
    material.opacity = activeMode === 'outline' ? 0.26 : 1;
  });
}

function createEdgeOverlay(mesh: MeshLike) {
  if (!mesh.geometry) {
    return null;
  }

  const edgesGeometry = new THREE.EdgesGeometry(mesh.geometry, 26);
  const edgesMaterial = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.95,
  });

  const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
  edges.name = '__edgeOverlay';
  edges.renderOrder = 2;

  return edges;
}

function syncOutlineOverlays(rootObject: THREE.Object3D, active: boolean) {
  rootObject.traverse((node) => {
    if (!isMesh(node)) {
      return;
    }

    let overlay = node.getObjectByName('__edgeOverlay') || null;

    if (!overlay && active) {
      const createdOverlay = createEdgeOverlay(node);

      if (createdOverlay) {
        node.add(createdOverlay);
        overlay = createdOverlay;
      }
    }

    if (overlay) {
      overlay.visible = active;
    }
  });
}

function clearSelection(mesh: MeshLike | null) {
  if (!mesh) {
    return;
  }

  asMaterialArray(mesh.material).forEach((material) => {
    if (!hasEmissive(material)) {
      return;
    }

    material.emissive.setHex(0x000000);
    material.emissiveIntensity = 0;
  });
}

function applySelection(mesh: MeshLike | null) {
  if (!mesh) {
    return;
  }

  asMaterialArray(mesh.material).forEach((material) => {
    if (!hasEmissive(material)) {
      return;
    }

    material.emissive.setHex(0x258cf4);
    material.emissiveIntensity = 0.3;
  });
}

function fitToView(camera: THREE.PerspectiveCamera, controls: OrbitControls, object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 1);
  const distance = maxDimension * 1.9;

  camera.position.set(center.x + distance, center.y + distance * 0.8, center.z + distance);
  camera.near = 0.01;
  camera.far = Math.max(2000, distance * 40);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}

function inferResourcePath(url: string) {
  const clean = String(url || '').split('#')[0].split('?')[0];
  const index = clean.lastIndexOf('/');

  if (index < 0) {
    return '';
  }

  return clean.slice(0, index + 1);
}

function inferMtlUrl(url: string) {
  return String(url || '').replace(/\.obj(\?.*)?$/i, '.mtl$1');
}

async function loadWithOBJ(url: string) {
  const resourcePath = inferResourcePath(url);
  const mtlUrl = inferMtlUrl(url);
  const loader = new OBJLoader();

  if (mtlUrl !== url) {
    try {
      const mtlLoader = new MTLLoader();

      if (resourcePath) {
        mtlLoader.setResourcePath(resourcePath);
      }

      const materials = await new Promise<any>((resolve, reject) => {
        mtlLoader.load(mtlUrl, resolve, undefined, reject);
      });

      materials.preload();
      loader.setMaterials(materials);
    } catch {
      // Keep OBJ loading resilient when no MTL or texture files are present.
    }
  }

  return new Promise<THREE.Group>((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

function loadWithGLTF(url: string) {
  const loader = new GLTFLoader();

  return new Promise<THREE.Object3D>((resolve, reject) => {
    loader.load(
      url,
      (result) => resolve(result.scene),
      undefined,
      reject,
    );
  });
}

function buildFallbackMesh() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0x4f46e5,
    roughness: 0.45,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.8), material);
  mesh.userData.displayName = 'Fallback Mesh';
  group.add(mesh);
  return group;
}

function inferFormat(modelUrl?: string | null, modelFormat?: string | null) {
  const explicit = String(modelFormat || '').trim().toLowerCase();

  if (explicit) {
    return explicit;
  }

  const source = String(modelUrl || '').toLowerCase();

  if (source.endsWith('.glb')) {
    return 'glb';
  }

  if (source.endsWith('.gltf')) {
    return 'gltf';
  }

  return 'obj';
}

function distanceLabel(meters: number) {
  const feet = Number(meters || 0) * 3.28084;
  return `${feet.toFixed(2)} ft`;
}

function clearGroup(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObject3D(child);
  }
}

const MIN_MEASURE_FEET = 0.5;
const MAX_MEASURE_FEET = 20;

export default function ModelViewport({
  modelUrl,
  modelUrlCandidates = [],
  modelFormat,
  viewMode = 'textured',
  uvTextureEnabled = false,
  interactionMode = 'navigate',
  annotations = [],
  onAddAnnotation,
  onMeasureChange,
  onSelectionChange,
  onViewerReady,
}: ModelViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const loadedObjectRef = useRef<THREE.Object3D | null>(null);
  const selectedMeshRef = useRef<MeshLike | null>(null);
  const runtimeRef = useRef<ViewerRuntime | null>(null);
  const measurePointsRef = useRef<THREE.Vector3[]>([]);
  const interactionModeRef = useRef<ModelViewportInteractionMode>(interactionMode);
  const annotationsRef = useRef<ScanAnnotation[]>(annotations);
  const onAddAnnotationRef = useRef(onAddAnnotation);
  const onMeasureChangeRef = useRef(onMeasureChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onViewerReadyRef = useRef(onViewerReady);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    interactionModeRef.current = interactionMode;
  }, [interactionMode]);

  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  useEffect(() => {
    onAddAnnotationRef.current = onAddAnnotation;
  }, [onAddAnnotation]);

  useEffect(() => {
    onMeasureChangeRef.current = onMeasureChange;
  }, [onMeasureChange]);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    onViewerReadyRef.current = onViewerReady;
  }, [onViewerReady]);

  useEffect(() => {
    const mount = containerRef.current;

    if (!mount) {
      return undefined;
    }

    let active = true;
    let frameId = 0;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);

    const camera = new THREE.PerspectiveCamera(52, mount.clientWidth / Math.max(1, mount.clientHeight), 0.01, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.touchAction = 'none';
    mount.style.touchAction = 'none';
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.screenSpacePanning = true;
    controls.zoomSpeed = 0.95;
    controls.rotateSpeed = 0.85;
    controls.panSpeed = 0.9;
    controls.maxDistance = 50;
    controls.minDistance = 0.4;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    controls.touches.ONE = THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.95);
    keyLight.position.set(4, 7, 5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x60a5fa, 0.45);
    fillLight.position.set(-5, 2, -4);
    scene.add(fillLight);

    const grid = new THREE.GridHelper(8, 20, 0x1e3a8a, 0x1e293b);
    grid.position.y = -1.1;
    scene.add(grid);

    const measurementGroup = new THREE.Group();
    measurementGroup.name = '__measurements';
    scene.add(measurementGroup);

    const annotationGroup = new THREE.Group();
    annotationGroup.name = '__annotations';
    scene.add(annotationGroup);

    const runtime: ViewerRuntime = {
      scene,
      camera,
      renderer,
      controls,
      measurementGroup,
      annotationGroup,
      hiddenMeshStack: [],
      meshLabelCount: 0,
    };

    runtimeRef.current = runtime;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const setSelection = (mesh: MeshLike | null) => {
      clearSelection(selectedMeshRef.current);
      selectedMeshRef.current = mesh;
      applySelection(selectedMeshRef.current);

      const label = selectedMeshRef.current?.userData?.displayName;
      onSelectionChangeRef.current?.(typeof label === 'string' ? label : '');
    };

    const clearMeasurements = () => {
      measurePointsRef.current = [];
      clearGroup(measurementGroup);
      onMeasureChangeRef.current?.(null);
    };

    const addMeasurePoint = (point: THREE.Vector3) => {
      if (measurePointsRef.current.length >= 2) {
        clearMeasurements();
      }

      measurePointsRef.current.push(point.clone());

      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 14, 14),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
      );
      marker.position.copy(point);
      measurementGroup.add(marker);

      if (measurePointsRef.current.length !== 2) {
        return;
      }

      const [first, second] = measurePointsRef.current;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([first, second]),
        new THREE.LineBasicMaterial({ color: 0x60a5fa }),
      );
      measurementGroup.add(line);

      const distanceMeters = first.distanceTo(second);
      const distanceFeet = distanceMeters * 3.28084;
      const withinRange = distanceFeet >= MIN_MEASURE_FEET && distanceFeet <= MAX_MEASURE_FEET;

      onMeasureChangeRef.current?.({
        distanceMeters,
        distanceFeet,
        label: distanceLabel(distanceMeters),
        minFeet: MIN_MEASURE_FEET,
        maxFeet: MAX_MEASURE_FEET,
        withinRange,
        points: [
          { x: first.x, y: first.y, z: first.z },
          { x: second.x, y: second.y, z: second.z },
        ],
      });
    };

    const addAnnotationAtPoint = (point: THREE.Vector3) => {
      const count = annotationsRef.current.length + 1;

      onAddAnnotationRef.current?.({
        id: `ann-${Date.now()}-${count}`,
        text: `Annotation ${count}`,
        position: {
          x: point.x,
          y: point.y,
          z: point.z,
        },
      });
    };

    const viewerApi: ModelViewportApi = {
      zoomIn: () => {
        const direction = new THREE.Vector3();
        controls.object.getWorldDirection(direction);
        controls.object.position.add(direction.multiplyScalar(0.35));
      },
      zoomOut: () => {
        const direction = new THREE.Vector3();
        controls.object.getWorldDirection(direction);
        controls.object.position.add(direction.multiplyScalar(-0.35));
      },
      resetView: () => {
        if (loadedObjectRef.current) {
          fitToView(camera, controls, loadedObjectRef.current);
        }
      },
      clearMeasurements,
      hideSelectedMesh: () => {
        const selected = selectedMeshRef.current;

        if (!selected || !selected.visible) {
          return false;
        }

        selected.visible = false;
        runtime.hiddenMeshStack.push(selected);
        setSelection(null);

        return true;
      },
      undoMeshEdit: () => {
        const mesh = runtime.hiddenMeshStack.pop();

        if (!mesh) {
          return false;
        }

        mesh.visible = true;
        return true;
      },
      showAllMeshes: () => {
        if (!loadedObjectRef.current) {
          return;
        }

        loadedObjectRef.current.traverse((node) => {
          if (isMesh(node)) {
            node.visible = true;
          }
        });

        runtime.hiddenMeshStack = [];
      },
    };

    onViewerReadyRef.current?.(viewerApi);

    const pickOnModel = (clientX: number, clientY: number) => {
      if (!loadedObjectRef.current) {
        return;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObject(loadedObjectRef.current, true);
      const hit = intersects.find((item) => isMesh(item.object));

      if (!hit || !isMesh(hit.object)) {
        return;
      }

      const mode = interactionModeRef.current;

      if (mode === 'measure') {
        addMeasurePoint(hit.point);
        return;
      }

      if (mode === 'annotate') {
        addAnnotationAtPoint(hit.point);
        return;
      }

      setSelection(hit.object);
    };

    const tapThresholdPx = 8;
    const tapTimeoutMs = 350;
    const activePointers = new Map<number, { startX: number; startY: number; startTime: number; moved: boolean }>();

    const onPointerDown = (event: PointerEvent) => {
      activePointers.set(event.pointerId, {
        startX: event.clientX,
        startY: event.clientY,
        startTime: performance.now(),
        moved: false,
      });
    };

    const onPointerMove = (event: PointerEvent) => {
      const state = activePointers.get(event.pointerId);

      if (!state) {
        return;
      }

      if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) > tapThresholdPx) {
        state.moved = true;
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const state = activePointers.get(event.pointerId);
      activePointers.delete(event.pointerId);

      if (!state) {
        return;
      }

      const isTap = !state.moved && performance.now() - state.startTime <= tapTimeoutMs;
      const mode = interactionModeRef.current;

      if (!isTap || mode === 'navigate' || activePointers.size > 0) {
        return;
      }

      pickOnModel(event.clientX, event.clientY);
    };

    const onPointerCancel = (event: PointerEvent) => {
      activePointers.delete(event.pointerId);
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerCancel);

    const resize = () => {
      camera.aspect = mount.clientWidth / Math.max(1, mount.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };

    window.addEventListener('resize', resize);

    const renderLoop = () => {
      if (!active) {
        return;
      }

      controls.update();
      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(renderLoop);
    };

    const load = async () => {
      setLoading(true);
      setError('');

      try {
        const urlCandidates = [...new Set([modelUrl, ...modelUrlCandidates].map((value) => String(value || '').trim()).filter(Boolean))];
        let object3d: THREE.Object3D | null = null;
        let lastLoadError: unknown = null;

        for (const candidate of urlCandidates) {
          const format = inferFormat(candidate, modelFormat);

          try {
            object3d =
              format === 'glb' || format === 'gltf' ? await loadWithGLTF(candidate) : await loadWithOBJ(candidate);
            break;
          } catch (candidateLoadError) {
            lastLoadError = candidateLoadError;
          }
        }

        if (!object3d) {
          if (lastLoadError) {
            throw lastLoadError;
          }

          object3d = buildFallbackMesh();
        }

        if (!active) {
          return;
        }

        runtime.meshLabelCount = 0;
        object3d.traverse((node) => {
          if (!isMesh(node)) {
            return;
          }

          runtime.meshLabelCount += 1;

          if (!node.userData.displayName) {
            const baseName = node.name || node.parent?.name || 'Mesh';
            node.userData.displayName = `${baseName} ${runtime.meshLabelCount}`;
          }
        });

        loadedObjectRef.current = object3d;
        scene.add(object3d);
        fitToView(camera, controls, object3d);
        setLoading(false);
      } catch (loadError) {
        if (!active) {
          return;
        }

        const fallback = buildFallbackMesh();
        loadedObjectRef.current = fallback;
        scene.add(fallback);
        fitToView(camera, controls, fallback);
        setError(loadError instanceof Error ? loadError.message : 'Unable to load model file.');
        setLoading(false);
      }
    };

    void load();
    renderLoop();

    return () => {
      active = false;
      window.cancelAnimationFrame(frameId);
      onViewerReadyRef.current?.(null);
      onSelectionChangeRef.current?.('');

      clearSelection(selectedMeshRef.current);
      selectedMeshRef.current = null;
      measurePointsRef.current = [];

      window.removeEventListener('resize', resize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerCancel);

      if (loadedObjectRef.current) {
        scene.remove(loadedObjectRef.current);
        disposeObject3D(loadedObjectRef.current);
        loadedObjectRef.current = null;
      }

      clearGroup(measurementGroup);
      clearGroup(annotationGroup);
      controls.dispose();
      renderer.dispose();
      runtimeRef.current = null;

      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [modelFormat, modelUrl, modelUrlCandidates]);

  useEffect(() => {
    const runtime = runtimeRef.current;

    if (!runtime) {
      return;
    }

    clearGroup(runtime.annotationGroup);

    annotations.forEach((annotation) => {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xf59e0b }),
      );
      marker.position.set(annotation.position.x, annotation.position.y, annotation.position.z);

      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.038, 0.05, 24),
        new THREE.MeshBasicMaterial({
          color: 0xfde68a,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
        }),
      );
      halo.position.copy(marker.position);
      halo.lookAt(runtime.camera.position);

      runtime.annotationGroup.add(marker);
      runtime.annotationGroup.add(halo);
    });
  }, [annotations]);

  useEffect(() => {
    const root = loadedObjectRef.current;

    if (!root) {
      return;
    }

    root.traverse((node) => {
      if (!isMesh(node)) {
        return;
      }

      setModeForMesh(node, viewMode);
      applyUvTextureForMesh(node, uvTextureEnabled);
    });

    syncOutlineOverlays(root, viewMode === 'outline');
  }, [loading, uvTextureEnabled, viewMode]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />

      {loading ? (
        <div className="absolute inset-x-6 top-6 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs text-slate-300">
          Loading model...
        </div>
      ) : null}

      {error ? (
        <div className="absolute inset-x-6 bottom-6 rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
          Model loaded with fallback preview: {error}
        </div>
      ) : null}
    </div>
  );
}
