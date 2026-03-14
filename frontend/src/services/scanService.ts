import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { authChangedEventName, getAuthToken } from './authService';
import { listNativeSavedModels } from './scannerService';

export type ScanAnnotation = {
  id: string;
  text: string;
  position: {
    x: number;
    y: number;
    z: number;
  };
  source?: string;
  confidence?: number;
};

export type ScanRecord = {
  id: string;
  remoteId?: string;
  title: string;
  capturedAt: string;
  capturedAtIso: string;
  status: string;
  progress: number;
  sizeLabel: string;
  sizeBytes: number;
  thumbnail: string;
  modelUrl: string;
  fileDownloadUrl: string;
  modelPath: string;
  modelFormat: string;
  vertexCount: number;
  faceCount: number;
  pointsCaptured: number;
  scanQuality: number;
  estimatedAccuracyMm: number;
  arEngine: string;
  source: string;
  storageLocation: string;
  syncState: string;
  cloudModelUrl: string;
  cloudSyncedAt: string;
  annotations: ScanAnnotation[];
  createdAt: string;
  updatedAt: string;
  originalFilename: string;
  contentType: string;
  uploadMetadata?: Record<string, unknown> | null;
  lastSyncError?: string;
};

type CreateCapturedScanInput = {
  exportData?: Record<string, unknown> | null;
  metrics?: Record<string, unknown> | null;
  capabilities?: Record<string, unknown> | null;
  title?: string;
  annotations?: unknown[];
};

type FetchScansInput = {
  tab?: string;
  query?: string;
};

type NativeSavedModel = {
  id?: string;
  title?: string;
  filePath?: string;
  fileUrl?: string;
  format?: string;
  fileSizeBytes?: number;
  capturedAtMs?: number;
};

const RECENT_LIMIT = 2;
const AUTO_SYNC_INTERVAL_MS = 15_000;
const LOCAL_SCANS_KEY = 'lidarpro.scans.local.v1';
const DEFAULT_CAPTURE_THUMBNAIL =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuCCjW0KBlGYx93IdgjzBNlzXyV254j3H6gT_QM_UZbpq8VRNOQMzigApr1_uNiHmNPbrWp1w5jLOtw6isCxyiHlv6x0DYny_s7d5v8CMhPvjBoCisX-j24ZC4BoNaA_hglqVW4z2gdAxyAfh0zpyOqzZ6LjGWUxg5i0jZN0lWh3h4dS4TVqOsUD4aPnzYCS9RVdKIT2vorb20aElEwcvOvm8XuGEvceBX0mDhg5DWT-ZuUCDZzoMoaEorzkNUR3FLgs-uhiC32jMg';

const API_BASE_URL = resolveApiBaseUrl();
const uploadInFlightIds = new Set<string>();
let localScansCache: ScanRecord[] | null = null;
let localScansLoadPromise: Promise<ScanRecord[]> | null = null;
let lastAutoSyncAt = 0;
let backgroundSyncBootstrapped = false;
let backgroundSyncIntervalId: number | null = null;
let backgroundSyncPromise: Promise<void> | null = null;

function resolveApiBaseUrl() {
  const value = String(import.meta.env.VITE_API_BASE_URL || '').trim();

  if (value) {
    return value.replace(/\/+$/, '');
  }

  return 'http://localhost:8080';
}

function isNativeRuntime() {
  return Capacitor.isNativePlatform();
}

function apiUrl(pathValue: string) {
  const path = String(pathValue || '').trim();

  if (!path) {
    return API_BASE_URL;
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  if (path.startsWith('/')) {
    return `${API_BASE_URL}${path}`;
  }

  return `${API_BASE_URL}/${path}`;
}

function toAbsoluteUrl(value: string) {
  const raw = String(value || '').trim();

  if (!raw) {
    return '';
  }

  if (/^(https?:|file:|blob:|capacitor:|ionic:)/i.test(raw)) {
    return raw;
  }

  if (raw.startsWith('/')) {
    return `${API_BASE_URL}${raw}`;
  }

  return `${API_BASE_URL}/${raw}`;
}

async function parseErrorMessage(response: Response) {
  const fallback = `Request failed (${response.status})`;

  try {
    const payload = await response.json();

    if (typeof payload?.message === 'string' && payload.message.trim()) {
      return payload.message;
    }

    return fallback;
  } catch {
    try {
      const text = await response.text();
      return text.trim() || fallback;
    } catch {
      return fallback;
    }
  }
}

async function request(pathValue: string, init: RequestInit = {}) {
  const authToken = getAuthToken();

  const response = await fetch(apiUrl(pathValue), {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function normalizeAnnotation(annotation: unknown, index: number): ScanAnnotation {
  const value = (annotation && typeof annotation === 'object' ? annotation : {}) as {
    id?: string;
    text?: string;
    position?: { x?: number; y?: number; z?: number };
    source?: string;
    confidence?: number;
  };
  const position = value.position || {};

  return {
    id: String(value.id || `ann-${Date.now()}-${index}`),
    text: String(value.text || `Annotation ${index + 1}`),
    position: {
      x: Number(position.x || 0),
      y: Number(position.y || 0),
      z: Number(position.z || 0),
    },
    source: value.source || undefined,
    confidence: typeof value.confidence === 'number' ? value.confidence : undefined,
  };
}

function normalizeAnnotations(annotations: unknown) {
  if (!Array.isArray(annotations)) {
    return [];
  }

  return annotations.map((annotation, index) => normalizeAnnotation(annotation, index));
}

function formatBytes(bytes: number) {
  const size = Math.max(0, Number(bytes || 0));

  if (size >= 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  return `${Math.max(1, Math.round(size / (1024 * 1024)))} MB`;
}

function formatCapturedAt(dateValue: string | number | Date | null | undefined) {
  const date = new Date(dateValue || Date.now());

  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function inferFormat(exportData: Record<string, unknown>) {
  const explicit = String(exportData.format || '').trim().toLowerCase();

  if (explicit) {
    return explicit;
  }

  const source = String(exportData.filePath || exportData.fileUrl || exportData.modelUrl || '').toLowerCase();

  if (source.endsWith('.glb')) {
    return 'glb';
  }

  if (source.endsWith('.gltf')) {
    return 'gltf';
  }

  if (source.endsWith('.obj')) {
    return 'obj';
  }

  return 'glb';
}

function toNativeFileUrl(pathValue: string) {
  const path = String(pathValue || '').trim();

  if (!path) {
    return '';
  }

  if (path.startsWith('file://')) {
    return path;
  }

  if (path.startsWith('/')) {
    return `file://${path}`;
  }

  return path;
}

function toFetchableFileUrl(pathValue: string) {
  const raw = String(pathValue || '').trim();

  if (!raw) {
    return '';
  }

  if (/^https?:\/\//i.test(raw) || /^blob:/i.test(raw)) {
    return raw;
  }

  if (raw.startsWith('file://')) {
    const withoutPrefix = raw.replace('file://', '');
    return Capacitor.convertFileSrc(withoutPrefix);
  }

  if (raw.startsWith('/')) {
    return Capacitor.convertFileSrc(raw);
  }

  return raw;
}

function defaultContentType(format: string) {
  if (format === 'glb') {
    return 'model/gltf-binary';
  }

  if (format === 'gltf') {
    return 'model/gltf+json';
  }

  if (format === 'obj') {
    return 'text/plain';
  }

  return 'application/octet-stream';
}

function inferFilenameFromPath(pathValue: string, fallbackFormat: string) {
  const path = String(pathValue || '').trim();

  if (!path) {
    return `scan-${Date.now()}.${fallbackFormat}`;
  }

  const normalized = path.split('?')[0];
  const parts = normalized.split('/').filter(Boolean);
  const candidate = parts.length ? parts[parts.length - 1] : '';

  if (!candidate || !candidate.includes('.')) {
    return `scan-${Date.now()}.${fallbackFormat}`;
  }

  return candidate;
}

async function loadModelBlob(exportData: Record<string, unknown>) {
  if (exportData.fileBlob instanceof Blob) {
    const format = inferFormat(exportData);
    return {
      blob: exportData.fileBlob,
      fileName: inferFilenameFromPath(String(exportData.filePath || exportData.fileUrl || ''), format),
      format,
    };
  }

  const format = inferFormat(exportData);
  const sourceCandidates = [
    exportData.filePath,
    exportData.fileUrl,
    exportData.modelUrl,
    exportData.cloudModelUrl,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  for (const source of sourceCandidates) {
    const fetchableUrl = toFetchableFileUrl(source);

    if (!fetchableUrl) {
      continue;
    }

    try {
      const response = await fetch(fetchableUrl);

      if (!response.ok) {
        continue;
      }

      const blob = await response.blob();

      if (!blob.size) {
        continue;
      }

      const fileName = inferFilenameFromPath(source, format);
      return {
        blob,
        fileName,
        format,
      };
    } catch {
      // Keep trying next source candidate.
    }
  }

  throw new Error('No model file available for upload. Make sure scan export generated a file.');
}

function mapBackendScan(scan: Record<string, any>): ScanRecord {
  const capturedAtIso = String(scan.capturedAt || scan.createdAt || new Date().toISOString());
  const sizeBytes = Number(scan.fileSizeBytes || 0);

  return {
    id: String(scan.id || ''),
    title: String(scan.title || 'Captured Scan'),
    capturedAt: formatCapturedAt(capturedAtIso),
    capturedAtIso,
    status: String(scan.status || 'processed'),
    progress: String(scan.status || '') === 'exporting' ? Number(scan.progress || 0) : 100,
    sizeLabel: formatBytes(sizeBytes),
    sizeBytes,
    thumbnail: DEFAULT_CAPTURE_THUMBNAIL,
    modelUrl: toAbsoluteUrl(String(scan.modelUrl || scan.fileDownloadUrl || '')),
    fileDownloadUrl: toAbsoluteUrl(String(scan.fileDownloadUrl || scan.modelUrl || '')),
    modelPath: String(scan.extraMetadata?.deviceFilePath || ''),
    modelFormat: String(scan.modelFormat || ''),
    vertexCount: Number(scan.vertexCount || 0),
    faceCount: Number(scan.faceCount || 0),
    pointsCaptured: Number(scan.pointsCaptured || 0),
    scanQuality: Number(scan.scanQuality || 0),
    estimatedAccuracyMm: Number(scan.estimatedAccuracyMm || 0),
    arEngine: String(scan.arEngine || ''),
    source: String(scan.source || 'cloud'),
    storageLocation: String(scan.storageLocation || 'cloud'),
    syncState: String(scan.syncState || 'synced'),
    cloudModelUrl: toAbsoluteUrl(String(scan.cloudModelUrl || '')),
    cloudSyncedAt: String(scan.cloudSyncedAt || ''),
    annotations: normalizeAnnotations(scan.annotations),
    createdAt: String(scan.createdAt || ''),
    updatedAt: String(scan.updatedAt || ''),
    originalFilename: String(scan.originalFilename || ''),
    contentType: String(scan.contentType || ''),
  };
}

function hashString(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash);
}

function createLocalId(seed: string) {
  return `local-${hashString(seed)}-${Date.now()}`;
}

function serializeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return '[]';
  }
}

function parseJsonArray(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readRawLocalScans() {
  if (isNativeRuntime()) {
    try {
      const result = await Preferences.get({ key: LOCAL_SCANS_KEY });
      return parseJsonArray(result.value);
    } catch {
      return [];
    }
  }

  if (typeof window === 'undefined') {
    return [];
  }

  try {
    return parseJsonArray(window.localStorage.getItem(LOCAL_SCANS_KEY));
  } catch {
    return [];
  }
}

async function writeRawLocalScans(scans: ScanRecord[]) {
  const serialized = serializeJson(scans);

  if (isNativeRuntime()) {
    await Preferences.set({ key: LOCAL_SCANS_KEY, value: serialized });
    return;
  }

  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(LOCAL_SCANS_KEY, serialized);
  } catch {
    // Ignore write failures to keep in-memory workflow alive.
  }
}

function normalizeLocalScan(raw: Record<string, any>): ScanRecord {
  const capturedAtIso = String(raw.capturedAtIso || raw.capturedAt || raw.createdAt || new Date().toISOString());
  const sizeBytes = Number(raw.sizeBytes || raw.fileSizeBytes || 0);
  const modelPath = String(raw.modelPath || raw.filePath || '');
  const modelUrl = String(raw.modelUrl || raw.fileUrl || toFetchableFileUrl(modelPath));
  const nowIso = new Date().toISOString();

  return {
    id: String(raw.id || createLocalId(modelPath || nowIso)),
    remoteId: String(raw.remoteId || ''),
    title: String(raw.title || 'Captured Scan'),
    capturedAtIso,
    capturedAt: formatCapturedAt(capturedAtIso),
    status: String(raw.status || 'processed'),
    progress: Number(raw.progress || 100),
    sizeBytes,
    sizeLabel: formatBytes(sizeBytes),
    thumbnail: String(raw.thumbnail || DEFAULT_CAPTURE_THUMBNAIL),
    modelPath,
    modelUrl: toFetchableFileUrl(modelUrl || modelPath),
    fileDownloadUrl: toFetchableFileUrl(String(raw.fileDownloadUrl || modelUrl || modelPath)),
    modelFormat: String(raw.modelFormat || inferFormat(raw)),
    vertexCount: Number(raw.vertexCount || 0),
    faceCount: Number(raw.faceCount || 0),
    pointsCaptured: Number(raw.pointsCaptured || 0),
    scanQuality: Number(raw.scanQuality || 0),
    estimatedAccuracyMm: Number(raw.estimatedAccuracyMm || 0),
    arEngine: String(raw.arEngine || ''),
    source: String(raw.source || 'device'),
    storageLocation: String(raw.storageLocation || 'device'),
    syncState: String(raw.syncState || 'local'),
    cloudModelUrl: String(raw.cloudModelUrl || ''),
    cloudSyncedAt: String(raw.cloudSyncedAt || ''),
    annotations: normalizeAnnotations(raw.annotations),
    createdAt: String(raw.createdAt || capturedAtIso || nowIso),
    updatedAt: String(raw.updatedAt || nowIso),
    originalFilename: String(raw.originalFilename || inferFilenameFromPath(modelPath, String(raw.modelFormat || 'obj'))),
    contentType: String(raw.contentType || defaultContentType(String(raw.modelFormat || 'obj'))),
    uploadMetadata: raw.uploadMetadata || null,
    lastSyncError: String(raw.lastSyncError || ''),
  };
}

async function loadLocalScans() {
  if (localScansCache) {
    return localScansCache;
  }

  if (!localScansLoadPromise) {
    localScansLoadPromise = (async () => {
      const raw = await readRawLocalScans();
      const normalized = raw.map((item) => normalizeLocalScan(item));
      localScansCache = normalized;
      return normalized;
    })().finally(() => {
      localScansLoadPromise = null;
    });
  }

  return localScansLoadPromise;
}

async function persistLocalScans(scans: ScanRecord[]) {
  const normalized = scans.map((scan) => normalizeLocalScan(scan));
  localScansCache = normalized;
  await writeRawLocalScans(normalized);
  return normalized;
}

async function upsertLocalScan(scan: Record<string, any>) {
  const current = await loadLocalScans();
  const next = [...current];
  const index = next.findIndex((item) => item.id === scan.id);

  if (index >= 0) {
    next[index] = normalizeLocalScan({
      ...next[index],
      ...scan,
      updatedAt: new Date().toISOString(),
    });
  } else {
    next.unshift(normalizeLocalScan(scan));
  }

  const saved = await persistLocalScans(next);
  return saved.find((item) => item.id === scan.id) || null;
}

async function removeLocalScan(scanId: string) {
  const current = await loadLocalScans();
  const index = current.findIndex((item) => item.id === scanId);

  if (index < 0) {
    return null;
  }

  const removed = current[index];
  const next = current.filter((item) => item.id !== scanId);
  await persistLocalScans(next);
  return removed;
}

async function mergeNativeFolderModels() {
  const existing = await loadLocalScans();
  const byPath = new Map(existing.map((item) => [String(item.modelPath || ''), item]));
  const nativeModels = (await listNativeSavedModels()) as NativeSavedModel[];

  if (!Array.isArray(nativeModels) || nativeModels.length === 0) {
    return existing;
  }

  let hasChanges = false;
  const merged = [...existing];

  for (const nativeModel of nativeModels) {
    const modelPath = String(nativeModel?.filePath || '').trim();

    if (!modelPath || byPath.has(modelPath)) {
      continue;
    }

    const capturedAtIso = nativeModel?.capturedAtMs
      ? new Date(Number(nativeModel.capturedAtMs)).toISOString()
      : new Date().toISOString();

    const localRecord = normalizeLocalScan({
      id: String(nativeModel?.id || `local-native-${hashString(modelPath)}`),
      title: String(nativeModel?.title || inferFilenameFromPath(modelPath, String(nativeModel?.format || 'obj'))),
      capturedAtIso,
      sizeBytes: Number(nativeModel?.fileSizeBytes || 0),
      modelPath,
      modelUrl: toFetchableFileUrl(String(nativeModel?.fileUrl || modelPath)),
      fileDownloadUrl: toFetchableFileUrl(String(nativeModel?.fileUrl || modelPath)),
      modelFormat: String(nativeModel?.format || inferFormat(nativeModel || {})),
      source: 'device',
      storageLocation: 'device',
      syncState: 'local',
      status: 'processed',
      progress: 100,
    });

    merged.push(localRecord);
    byPath.set(modelPath, localRecord);
    hasChanges = true;
  }

  if (!hasChanges) {
    return existing;
  }

  await persistLocalScans(merged);
  return merged;
}

function byTab(scans: ScanRecord[], tab: string) {
  if (tab === 'recent') {
    return scans.slice(0, RECENT_LIMIT);
  }

  if (tab === 'cloud') {
    return scans.filter(
      (scan) => scan.storageLocation === 'cloud' || scan.syncState === 'synced' || scan.source === 'cloud',
    );
  }

  return scans;
}

function byQuery(scans: ScanRecord[], query: string) {
  const term = String(query || '').trim().toLowerCase();

  if (!term) {
    return scans;
  }

  return scans.filter((scan) => String(scan.title || '').toLowerCase().includes(term));
}

function sortByCapturedAtDesc(scans: ScanRecord[]) {
  return [...scans].sort((a, b) => {
    const aTime = new Date(a.capturedAtIso || a.capturedAt || 0).getTime();
    const bTime = new Date(b.capturedAtIso || b.capturedAt || 0).getTime();
    return bTime - aTime;
  });
}

function mergeLocalAndRemoteScans(localScans: ScanRecord[], remoteScans: ScanRecord[]) {
  const linkedRemoteIds = new Set(localScans.map((scan) => String(scan.remoteId || '').trim()).filter(Boolean));
  const merged = [...localScans];

  for (const remoteScan of remoteScans) {
    if (!remoteScan.id) {
      continue;
    }

    if (linkedRemoteIds.has(remoteScan.id)) {
      continue;
    }

    if (localScans.some((scan) => scan.id === remoteScan.id)) {
      continue;
    }

    merged.push(remoteScan);
  }

  return sortByCapturedAtDesc(merged);
}

function buildCreateMetadata({ exportData, metrics, capabilities, title, annotations }: CreateCapturedScanInput) {
  const createdAt = new Date().toISOString();
  const exportValue = (exportData || {}) as Record<string, any>;
  const metricsValue = (metrics || {}) as Record<string, any>;
  const capabilitiesValue = (capabilities || {}) as Record<string, any>;
  const pointsCaptured = Math.max(0, Math.round(Number(metricsValue.pointsCaptured || 0) * 1_000_000));
  const format = inferFormat(exportValue);

  return {
    title: title || `Captured Scan ${formatCapturedAt(createdAt)}`,
    capturedAt: createdAt,
    arEngine: String(capabilitiesValue.arEngine || ''),
    modelFormat: format,
    status: 'processed',
    syncState: 'local',
    source: 'device',
    storageLocation: 'device',
    pointsCaptured,
    vertexCount: Number(exportValue.vertexCount || 0),
    faceCount: Number(exportValue.faceCount || 0),
    scanQuality: Math.round(Number(metricsValue.quality || 0)),
    estimatedAccuracyMm: Number(metricsValue.estimatedAccuracyMm || 0),
    scanDistanceMeters: Number(exportValue.maxDistanceMeters || 0) || undefined,
    scanDetailLevel: String(exportValue.detailLevel || '').trim() || undefined,
    platform: Capacitor.getPlatform(),
    textureIncluded: Boolean(exportValue.textureIncluded),
    uvEnabled: Boolean(exportValue.uvEnabled),
    annotations: normalizeAnnotations(annotations),
    extraMetadata: {
      deviceFilePath: String(exportValue.filePath || ''),
      deviceFileUrl: toNativeFileUrl(String(exportValue.filePath || exportValue.fileUrl || '')),
    },
  };
}

async function syncLocalScanToCloud(scanId: string) {
  if (!scanId) {
    return null;
  }

  const token = getAuthToken();

  if (!token || uploadInFlightIds.has(scanId)) {
    return null;
  }

  const localScans = await loadLocalScans();
  const record = localScans.find((item) => item.id === scanId);

  if (!record) {
    return null;
  }

  uploadInFlightIds.add(scanId);

  try {
    await upsertLocalScan({
      ...record,
      syncState: 'syncing',
      lastSyncError: '',
    });

    const payload = await loadModelBlob({
      filePath: record.modelPath,
      fileUrl: record.modelUrl,
      modelUrl: record.modelUrl,
      format: record.modelFormat,
    });

    const file = new File([payload.blob], record.originalFilename || payload.fileName, {
      type: payload.blob.type || record.contentType || defaultContentType(record.modelFormat),
    });

    const formData = new FormData();
    formData.append('file', file);

    const metadata = record.uploadMetadata || {
      title: record.title,
      capturedAt: record.capturedAtIso,
      modelFormat: record.modelFormat,
      status: 'processed',
      syncState: 'local',
      source: 'device',
      storageLocation: 'device',
      pointsCaptured: record.pointsCaptured,
      vertexCount: record.vertexCount,
      faceCount: record.faceCount,
      scanQuality: record.scanQuality,
      estimatedAccuracyMm: record.estimatedAccuracyMm,
      arEngine: record.arEngine,
      annotations: normalizeAnnotations(record.annotations),
      extraMetadata: {
        deviceFilePath: record.modelPath,
        deviceFileUrl: toNativeFileUrl(record.modelPath),
      },
    };

    formData.append('metadata', JSON.stringify(metadata));

    const response = await request('/api/scans', {
      method: 'POST',
      body: formData,
    });

    const remoteScan = mapBackendScan(response as Record<string, any>);
    const synced = await upsertLocalScan({
      ...record,
      remoteId: remoteScan.id,
      syncState: 'synced',
      storageLocation: 'cloud',
      cloudSyncedAt: new Date().toISOString(),
      cloudModelUrl: remoteScan.cloudModelUrl || remoteScan.modelUrl || '',
      lastSyncError: '',
    });

    return synced || remoteScan;
  } catch (error) {
    await upsertLocalScan({
      ...record,
      syncState: 'local',
      lastSyncError: error instanceof Error ? error.message : 'Upload failed.',
    });

    return null;
  } finally {
    uploadInFlightIds.delete(scanId);
  }
}

function shouldAutoSync() {
  const token = getAuthToken();

  if (!token) {
    return false;
  }

  const now = Date.now();

  if (now - lastAutoSyncAt < AUTO_SYNC_INTERVAL_MS) {
    return false;
  }

  lastAutoSyncAt = now;
  return true;
}

async function runBackgroundSync(force = false) {
  if (!getAuthToken()) {
    return;
  }

  if (!force && !shouldAutoSync()) {
    return;
  }

  if (backgroundSyncPromise) {
    return backgroundSyncPromise;
  }

  backgroundSyncPromise = (async () => {
    const scans = sortByCapturedAtDesc(await mergeNativeFolderModels());
    const pending = scans.filter((scan) => scan.source === 'device' && scan.syncState !== 'synced');

    if (!pending.length) {
      return;
    }

    await Promise.allSettled(pending.map((scan) => syncLocalScanToCloud(scan.id)));
  })().finally(() => {
    backgroundSyncPromise = null;
  });

  return backgroundSyncPromise;
}

function stopBackgroundSyncLoop() {
  if (backgroundSyncIntervalId !== null && typeof window !== 'undefined') {
    window.clearInterval(backgroundSyncIntervalId);
  }

  backgroundSyncIntervalId = null;
}

function startBackgroundSyncLoop() {
  if (typeof window === 'undefined') {
    return;
  }

  if (!getAuthToken()) {
    stopBackgroundSyncLoop();
    return;
  }

  if (backgroundSyncIntervalId !== null) {
    return;
  }

  backgroundSyncIntervalId = window.setInterval(() => {
    void runBackgroundSync();
  }, AUTO_SYNC_INTERVAL_MS);
}

function ensureBackgroundSyncBootstrap() {
  if (backgroundSyncBootstrapped || typeof window === 'undefined') {
    return;
  }

  backgroundSyncBootstrapped = true;

  const refreshLoop = () => {
    if (getAuthToken()) {
      startBackgroundSyncLoop();
      void runBackgroundSync(true);
      return;
    }

    stopBackgroundSyncLoop();
  };

  window.addEventListener(authChangedEventName(), refreshLoop);
  window.addEventListener('online', () => {
    void runBackgroundSync(true);
  });

  refreshLoop();
}

function startBackgroundSync(scans: ScanRecord[]) {
  ensureBackgroundSyncBootstrap();

  if (!shouldAutoSync()) {
    return;
  }

  const pending = scans.filter((scan) => scan.source === 'device' && scan.syncState !== 'synced');

  for (const scan of pending) {
    void syncLocalScanToCloud(scan.id);
  }
}

ensureBackgroundSyncBootstrap();

export async function fetchScans({ tab = 'all', query = '' }: FetchScansInput = {}) {
  const mergedLocal = await mergeNativeFolderModels();
  const localScans = sortByCapturedAtDesc(mergedLocal);

  let remoteScans: ScanRecord[] = [];

  if (getAuthToken()) {
    try {
      const response = await request('/api/scans');
      remoteScans = Array.isArray(response) ? response.map((scan) => mapBackendScan(scan)) : [];
    } catch {
      remoteScans = [];
    }
  }

  startBackgroundSync(localScans);

  const scans = mergeLocalAndRemoteScans(localScans, remoteScans);
  return byQuery(byTab(scans, tab), query);
}

export async function listAllScans() {
  return fetchScans({ tab: 'all', query: '' });
}

export async function getScanById(scanId: string) {
  if (!scanId) {
    return null;
  }

  const localScans = await mergeNativeFolderModels();
  const localMatch = localScans.find((scan) => scan.id === scanId || scan.remoteId === scanId);

  if (localMatch) {
    return localMatch;
  }

  try {
    const response = await request(`/api/scans/${encodeURIComponent(scanId)}`);
    return mapBackendScan(response as Record<string, any>);
  } catch {
    return null;
  }
}

export async function createCapturedScan({
  exportData,
  metrics,
  capabilities,
  title,
  annotations,
}: CreateCapturedScanInput = {}) {
  if (!exportData) {
    throw new Error('No scan data available to save.');
  }

  const metadata = buildCreateMetadata({
    exportData,
    metrics,
    capabilities,
    title,
    annotations,
  });

  const exportValue = exportData as Record<string, any>;
  const createdAtIso = String(metadata.capturedAt || new Date().toISOString());
  const modelPath = String(exportValue.filePath || metadata.extraMetadata?.deviceFilePath || '');
  const modelUrl = toFetchableFileUrl(String(exportValue.fileUrl || modelPath));
  const format = String(metadata.modelFormat || inferFormat(exportValue));
  const sizeBytes = Number(exportValue.fileSizeBytes || exportValue.sizeBytes || exportValue.byteLength || 0);
  const localId = createLocalId(`${modelPath}-${createdAtIso}`);

  const localScan = await upsertLocalScan({
    id: localId,
    title: String(metadata.title || 'Captured Scan'),
    capturedAtIso: createdAtIso,
    status: 'processed',
    progress: 100,
    sizeBytes,
    thumbnail: DEFAULT_CAPTURE_THUMBNAIL,
    modelPath,
    modelUrl,
    fileDownloadUrl: modelUrl,
    modelFormat: format,
    vertexCount: Number(metadata.vertexCount || exportValue.vertexCount || 0),
    faceCount: Number(metadata.faceCount || exportValue.faceCount || 0),
    pointsCaptured: Number(metadata.pointsCaptured || 0),
    scanQuality: Number(metadata.scanQuality || 0),
    estimatedAccuracyMm: Number(metadata.estimatedAccuracyMm || 0),
    arEngine: String(metadata.arEngine || (capabilities as Record<string, any> | null)?.arEngine || ''),
    source: 'device',
    storageLocation: 'device',
    syncState: 'local',
    cloudModelUrl: '',
    cloudSyncedAt: '',
    annotations: normalizeAnnotations(metadata.annotations),
    createdAt: createdAtIso,
    updatedAt: createdAtIso,
    originalFilename: inferFilenameFromPath(modelPath || modelUrl, format),
    contentType: defaultContentType(format),
    uploadMetadata: metadata,
  });

  if (localScan && getAuthToken()) {
    void syncLocalScanToCloud(localScan.id);
  }

  return localScan;
}

export async function saveScanAnnotations(scanId: string, annotations: unknown[]) {
  if (!scanId) {
    return null;
  }

  const localScans = await mergeNativeFolderModels();
  const localMatch = localScans.find((scan) => scan.id === scanId || scan.remoteId === scanId);
  const normalizedAnnotations = normalizeAnnotations(annotations);

  if (localMatch) {
    const updated = await upsertLocalScan({
      ...localMatch,
      annotations: normalizedAnnotations,
      updatedAt: new Date().toISOString(),
      uploadMetadata: {
        ...(localMatch.uploadMetadata || {}),
        annotations: normalizedAnnotations,
      },
    });

    if (updated?.remoteId && getAuthToken()) {
      try {
        await request(`/api/scans/${encodeURIComponent(updated.remoteId)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            annotations: normalizedAnnotations,
            extraMetadata: {
              lastEditedAt: new Date().toISOString(),
            },
          }),
        });
      } catch {
        // Local save still succeeds if cloud update fails.
      }
    }

    return updated;
  }

  const response = await request(`/api/scans/${encodeURIComponent(scanId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      annotations: normalizedAnnotations,
      extraMetadata: {
        lastEditedAt: new Date().toISOString(),
      },
    }),
  });

  return mapBackendScan(response as Record<string, any>);
}

export async function deleteCapturedScan(scanId: string) {
  if (!scanId) {
    return false;
  }

  const removed = await removeLocalScan(scanId);

  if (removed?.remoteId && getAuthToken()) {
    try {
      await request(`/api/scans/${encodeURIComponent(removed.remoteId)}`, {
        method: 'DELETE',
      });
    } catch {
      // Keep local delete success even if remote cleanup fails.
    }
  }

  if (removed) {
    return true;
  }

  try {
    await request(`/api/scans/${encodeURIComponent(scanId)}`, {
      method: 'DELETE',
    });
    return true;
  } catch {
    return false;
  }
}

export async function syncCapturedScan(scanId: string) {
  if (!scanId) {
    throw new Error('Scan id is required for sync.');
  }

  const localScans = await mergeNativeFolderModels();
  const localMatch = localScans.find((scan) => scan.id === scanId || scan.remoteId === scanId);

  if (localMatch) {
    if (!getAuthToken()) {
      throw new Error('Login required to sync with cloud.');
    }

    if (!localMatch.remoteId) {
      const synced = await syncLocalScanToCloud(localMatch.id);

      if (!synced) {
        throw new Error('Failed to upload scan to cloud.');
      }

      return synced;
    }

    const response = await request(`/api/scans/${encodeURIComponent(localMatch.remoteId)}/sync`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const cloudScan = mapBackendScan(response as Record<string, any>);
    const updated = await upsertLocalScan({
      ...localMatch,
      syncState: 'synced',
      storageLocation: 'cloud',
      cloudSyncedAt: cloudScan.cloudSyncedAt || new Date().toISOString(),
      cloudModelUrl: cloudScan.cloudModelUrl || cloudScan.modelUrl || localMatch.cloudModelUrl,
      remoteId: localMatch.remoteId,
      lastSyncError: '',
    });

    return updated || cloudScan;
  }

  const response = await request(`/api/scans/${encodeURIComponent(scanId)}/sync`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  return mapBackendScan(response as Record<string, any>);
}
