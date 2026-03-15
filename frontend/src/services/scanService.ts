import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { getAuthToken } from './authService';
import { requestApi, resolveApiBaseUrl } from './apiClient';
import { deleteNativeSavedModel, listNativeSavedModels } from './scannerService';

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

export type FetchScansInput = {
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
const LOCAL_SCANS_KEY = 'lidarpro.scans.local.v1';
const REMOTE_SCANS_CACHE_KEY = 'lidarpro.scans.remote.v1';
const LEGACY_LOCAL_SCANS_KEYS = [
  LOCAL_SCANS_KEY,
  'lidarpro.scans.local',
  'lidarpro.models.local.v1',
  'spacialpro.scans.local.v1',
  'spacial-pro.scans.local.v1',
];
const DEFAULT_CAPTURE_THUMBNAIL =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuCCjW0KBlGYx93IdgjzBNlzXyV254j3H6gT_QM_UZbpq8VRNOQMzigApr1_uNiHmNPbrWp1w5jLOtw6isCxyiHlv6x0DYny_s7d5v8CMhPvjBoCisX-j24ZC4BoNaA_hglqVW4z2gdAxyAfh0zpyOqzZ6LjGWUxg5i0jZN0lWh3h4dS4TVqOsUD4aPnzYCS9RVdKIT2vorb20aElEwcvOvm8XuGEvceBX0mDhg5DWT-ZuUCDZzoMoaEorzkNUR3FLgs-uhiC32jMg';

const API_BASE_URL = resolveApiBaseUrl();
const uploadInFlightIds = new Set<string>();
let localScansCache: ScanRecord[] | null = null;
let localScansLoadPromise: Promise<ScanRecord[]> | null = null;
let remoteScansCache: ScanRecord[] | null = null;
let remoteScansLoadPromise: Promise<ScanRecord[]> | null = null;

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

async function request(pathValue: string, init: RequestInit = {}) {
  return requestApi(pathValue, {
    method: init.method,
    body: init.body,
    headers: (init.headers || {}) as Record<string, string>,
    token: getAuthToken(),
  });
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

  if (source.endsWith('.stl')) {
    return 'stl';
  }

  if (source.endsWith('.ply')) {
    return 'ply';
  }

  if (source.endsWith('.usdz')) {
    return 'usdz';
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

  if (format === 'stl') {
    return 'model/stl';
  }

  if (format === 'ply') {
    return 'application/octet-stream';
  }

  if (format === 'usdz') {
    return 'model/vnd.usdz+zip';
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
  const cloudModelUrl = toAbsoluteUrl(String(scan.cloudModelUrl || ''));
  const fileDownloadUrl = toAbsoluteUrl(String(scan.fileDownloadUrl || scan.modelUrl || cloudModelUrl || ''));
  const modelUrl = cloudModelUrl || toAbsoluteUrl(String(scan.modelUrl || scan.fileDownloadUrl || ''));

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
    modelUrl,
    fileDownloadUrl,
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
    cloudModelUrl,
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

function normalizeModelPathKey(pathValue: string) {
  let raw = String(pathValue || '').trim();

  if (!raw) {
    return '';
  }

  if (raw.startsWith('file://')) {
    try {
      raw = decodeURIComponent(new URL(raw).pathname);
    } catch {
      raw = raw.replace(/^file:\/\//, '');
    }
  }

  raw = raw.replace(/^\/private(?=\/var\/)/, '');
  raw = raw.replace(/\/+/g, '/');
  return raw;
}

function resolveLocalIdentity(scan: Record<string, any>) {
  const modelPathKey = normalizeModelPathKey(String(scan.modelPath || scan.filePath || ''));

  if (modelPathKey) {
    return `path:${modelPathKey}`;
  }

  const remoteId = String(scan.remoteId || '').trim();

  if (remoteId) {
    return `remote:${remoteId}`;
  }

  const id = String(scan.id || '').trim();

  if (id) {
    return `id:${id}`;
  }

  return '';
}

function syncStateRank(syncState: string) {
  if (syncState === 'synced') {
    return 3;
  }

  if (syncState === 'syncing') {
    return 2;
  }

  return 1;
}

function serializeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return '[]';
  }
}

function extractArrayPayload(value: unknown) {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;

  if (Array.isArray(record.scans)) {
    return record.scans;
  }

  if (Array.isArray(record.items)) {
    return record.items;
  }

  if (Array.isArray(record.models)) {
    return record.models;
  }

  return [];
}

function parseJsonCollection(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return extractArrayPayload(parsed);
  } catch {
    return [];
  }
}

async function readRawLocalScans() {
  if (isNativeRuntime()) {
    try {
      for (const key of LEGACY_LOCAL_SCANS_KEYS) {
        const result = await Preferences.get({ key });
        const parsed = parseJsonCollection(result.value);

        if (parsed.length) {
          return parsed;
        }
      }

      return [];
    } catch {
      return [];
    }
  }

  if (typeof window === 'undefined') {
    return [];
  }

  try {
    for (const key of LEGACY_LOCAL_SCANS_KEYS) {
      const parsed = parseJsonCollection(window.localStorage.getItem(key));

      if (parsed.length) {
        return parsed;
      }
    }

    return [];
  } catch {
    return [];
  }
}

async function writeRawLocalScans(scans: ScanRecord[]) {
  const serialized = serializeJson(scans);
  const legacyKeysToClear = LEGACY_LOCAL_SCANS_KEYS.filter((key) => key !== LOCAL_SCANS_KEY);

  if (isNativeRuntime()) {
    if (scans.length) {
      await Preferences.set({ key: LOCAL_SCANS_KEY, value: serialized });
    } else {
      await Preferences.remove({ key: LOCAL_SCANS_KEY });
    }

    await Promise.all(legacyKeysToClear.map((key) => Preferences.remove({ key })));
    return;
  }

  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (scans.length) {
      window.localStorage.setItem(LOCAL_SCANS_KEY, serialized);
    } else {
      window.localStorage.removeItem(LOCAL_SCANS_KEY);
    }

    for (const key of legacyKeysToClear) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore write failures to keep in-memory workflow alive.
  }
}

async function readRawRemoteScans() {
  if (isNativeRuntime()) {
    try {
      const result = await Preferences.get({ key: REMOTE_SCANS_CACHE_KEY });
      return parseJsonCollection(result.value);
    } catch {
      return [];
    }
  }

  if (typeof window === 'undefined') {
    return [];
  }

  try {
    return parseJsonCollection(window.localStorage.getItem(REMOTE_SCANS_CACHE_KEY));
  } catch {
    return [];
  }
}

async function writeRawRemoteScans(scans: ScanRecord[]) {
  const serialized = serializeJson(scans);

  if (isNativeRuntime()) {
    if (scans.length) {
      await Preferences.set({ key: REMOTE_SCANS_CACHE_KEY, value: serialized });
    } else {
      await Preferences.remove({ key: REMOTE_SCANS_CACHE_KEY });
    }

    return;
  }

  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (scans.length) {
      window.localStorage.setItem(REMOTE_SCANS_CACHE_KEY, serialized);
    } else {
      window.localStorage.removeItem(REMOTE_SCANS_CACHE_KEY);
    }
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

function normalizeRemoteScan(raw: Record<string, any>): ScanRecord {
  const capturedAtIso = String(raw.capturedAtIso || raw.capturedAt || raw.createdAt || new Date().toISOString());
  const sizeBytes = Number(raw.sizeBytes || raw.fileSizeBytes || 0);
  const modelPath = String(raw.modelPath || raw.filePath || '');
  const cloudModelUrl = toAbsoluteUrl(String(raw.cloudModelUrl || raw.modelUrl || raw.fileDownloadUrl || ''));
  const modelUrl = cloudModelUrl || toAbsoluteUrl(String(raw.modelUrl || raw.fileDownloadUrl || ''));
  const fileDownloadUrl = toAbsoluteUrl(String(raw.fileDownloadUrl || raw.modelUrl || cloudModelUrl || ''));
  const nowIso = new Date().toISOString();

  return {
    id: String(raw.id || raw.remoteId || ''),
    remoteId: String(raw.remoteId || raw.id || ''),
    title: String(raw.title || 'Captured Scan'),
    capturedAtIso,
    capturedAt: formatCapturedAt(capturedAtIso),
    status: String(raw.status || 'processed'),
    progress: String(raw.status || '') === 'exporting' ? Number(raw.progress || 0) : 100,
    sizeBytes,
    sizeLabel: formatBytes(sizeBytes),
    thumbnail: String(raw.thumbnail || DEFAULT_CAPTURE_THUMBNAIL),
    modelPath,
    modelUrl,
    fileDownloadUrl,
    modelFormat: String(raw.modelFormat || inferFormat(raw)),
    vertexCount: Number(raw.vertexCount || 0),
    faceCount: Number(raw.faceCount || 0),
    pointsCaptured: Number(raw.pointsCaptured || 0),
    scanQuality: Number(raw.scanQuality || 0),
    estimatedAccuracyMm: Number(raw.estimatedAccuracyMm || 0),
    arEngine: String(raw.arEngine || ''),
    source: String(raw.source || 'cloud'),
    storageLocation: String(raw.storageLocation || 'cloud'),
    syncState: String(raw.syncState || 'synced'),
    cloudModelUrl,
    cloudSyncedAt: String(raw.cloudSyncedAt || raw.updatedAt || ''),
    annotations: normalizeAnnotations(raw.annotations),
    createdAt: String(raw.createdAt || capturedAtIso || nowIso),
    updatedAt: String(raw.updatedAt || nowIso),
    originalFilename: String(raw.originalFilename || inferFilenameFromPath(modelUrl || fileDownloadUrl, String(raw.modelFormat || 'glb'))),
    contentType: String(raw.contentType || defaultContentType(String(raw.modelFormat || 'glb'))),
    uploadMetadata: raw.uploadMetadata || null,
    lastSyncError: String(raw.lastSyncError || ''),
  };
}

function pickPreferredLocalRecord(current: ScanRecord, incoming: ScanRecord) {
  const currentScore =
    (current.remoteId ? 4 : 0) +
    (current.cloudModelUrl ? 3 : 0) +
    (current.uploadMetadata ? 2 : 0) +
    (current.annotations.length ? 2 : 0) +
    syncStateRank(current.syncState);
  const incomingScore =
    (incoming.remoteId ? 4 : 0) +
    (incoming.cloudModelUrl ? 3 : 0) +
    (incoming.uploadMetadata ? 2 : 0) +
    (incoming.annotations.length ? 2 : 0) +
    syncStateRank(incoming.syncState);

  return incomingScore > currentScore ? incoming : current;
}

function mergeLocalRecords(current: ScanRecord, incoming: ScanRecord) {
  const preferred = pickPreferredLocalRecord(current, incoming);
  const fallback = preferred === current ? incoming : current;
  const mergedCapturedAtIso =
    new Date(preferred.capturedAtIso || preferred.createdAt || 0).getTime() >=
    new Date(fallback.capturedAtIso || fallback.createdAt || 0).getTime()
      ? preferred.capturedAtIso
      : fallback.capturedAtIso;
  const mergedUpdatedAt =
    new Date(preferred.updatedAt || 0).getTime() >= new Date(fallback.updatedAt || 0).getTime()
      ? preferred.updatedAt
      : fallback.updatedAt;

  return normalizeLocalScan({
    ...fallback,
    ...preferred,
    id: preferred.id || fallback.id,
    remoteId: preferred.remoteId || fallback.remoteId,
    title:
      preferred.title && preferred.title !== 'Captured Scan'
        ? preferred.title
        : fallback.title || preferred.title,
    modelPath: preferred.modelPath || fallback.modelPath,
    modelUrl: preferred.modelUrl || fallback.modelUrl,
    fileDownloadUrl: preferred.fileDownloadUrl || fallback.fileDownloadUrl,
    syncState:
      syncStateRank(preferred.syncState) >= syncStateRank(fallback.syncState)
        ? preferred.syncState
        : fallback.syncState,
    cloudModelUrl: preferred.cloudModelUrl || fallback.cloudModelUrl,
    cloudSyncedAt: preferred.cloudSyncedAt || fallback.cloudSyncedAt,
    annotations: preferred.annotations.length ? preferred.annotations : fallback.annotations,
    uploadMetadata: preferred.uploadMetadata || fallback.uploadMetadata,
    lastSyncError: preferred.lastSyncError || fallback.lastSyncError,
    capturedAtIso: mergedCapturedAtIso,
    createdAt: preferred.createdAt || fallback.createdAt || mergedCapturedAtIso,
    updatedAt: mergedUpdatedAt || preferred.updatedAt || fallback.updatedAt,
  });
}

function dedupeLocalScans(scans: ScanRecord[]) {
  const deduped: ScanRecord[] = [];
  const indexByIdentity = new Map<string, number>();

  for (const scan of scans.map((item) => normalizeLocalScan(item))) {
    const identity = resolveLocalIdentity(scan);

    if (!identity) {
      deduped.push(scan);
      continue;
    }

    const existingIndex = indexByIdentity.get(identity);

    if (existingIndex == null) {
      indexByIdentity.set(identity, deduped.length);
      deduped.push(scan);
      continue;
    }

    deduped[existingIndex] = mergeLocalRecords(deduped[existingIndex], scan);
  }

  return deduped;
}

async function loadLocalScans() {
  if (localScansCache) {
    return localScansCache;
  }

  if (!localScansLoadPromise) {
    localScansLoadPromise = (async () => {
      const raw = await readRawLocalScans();
      const normalized = sortByCapturedAtDesc(dedupeLocalScans(raw.map((item) => normalizeLocalScan(item))));
      localScansCache = normalized;
      return normalized;
    })().finally(() => {
      localScansLoadPromise = null;
    });
  }

  return localScansLoadPromise;
}

async function loadCachedRemoteScans() {
  if (!getAuthToken()) {
    remoteScansCache = [];
    return [];
  }

  if (remoteScansCache) {
    return remoteScansCache;
  }

  if (!remoteScansLoadPromise) {
    remoteScansLoadPromise = (async () => {
      const raw = await readRawRemoteScans();
      const normalized = raw
        .map((item) => normalizeRemoteScan(item as Record<string, any>))
        .filter((item) => Boolean(item.id));
      remoteScansCache = normalized;
      return normalized;
    })().finally(() => {
      remoteScansLoadPromise = null;
    });
  }

  return remoteScansLoadPromise;
}

async function persistLocalScans(scans: ScanRecord[]) {
  const normalized = sortByCapturedAtDesc(dedupeLocalScans(scans.map((scan) => normalizeLocalScan(scan))));
  localScansCache = normalized;
  await writeRawLocalScans(normalized);
  return normalized;
}

async function persistRemoteScans(scans: ScanRecord[]) {
  const normalized = scans
    .map((scan) => normalizeRemoteScan(scan))
    .filter((scan) => Boolean(scan.id));
  remoteScansCache = normalized;
  await writeRawRemoteScans(normalized);
  return normalized;
}

async function removeCachedRemoteScan(scan: { id?: string; remoteId?: string } | null | undefined) {
  const remoteIds = new Set(
    [String(scan?.remoteId || '').trim(), String(scan?.id || '').trim()].filter(Boolean),
  );

  if (!remoteIds.size) {
    return;
  }

  const current = await loadCachedRemoteScans();
  const next = current.filter(
    (item) => !remoteIds.has(String(item.id || '').trim()) && !remoteIds.has(String(item.remoteId || '').trim()),
  );

  await persistRemoteScans(next);
}

async function upsertLocalScan(scan: Record<string, any>) {
  const current = await loadLocalScans();
  const next = [...current];
  const nextScan = normalizeLocalScan(scan);
  const nextIdentity = resolveLocalIdentity(nextScan);
  const index = next.findIndex(
    (item) => item.id === nextScan.id || (nextIdentity && resolveLocalIdentity(item) === nextIdentity),
  );

  if (index >= 0) {
    next[index] = mergeLocalRecords(
      next[index],
      normalizeLocalScan({
        ...next[index],
        ...scan,
        updatedAt: new Date().toISOString(),
      }),
    );
  } else {
    next.unshift(nextScan);
  }

  const saved = await persistLocalScans(next);
  return saved.find((item) => item.id === nextScan.id || (nextIdentity && resolveLocalIdentity(item) === nextIdentity)) || null;
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
  const byPath = new Map(
    existing
      .map((item) => [normalizeModelPathKey(String(item.modelPath || '')), item] as const)
      .filter(([key]) => Boolean(key)),
  );
  const nativeModels = (await listNativeSavedModels()) as NativeSavedModel[];

  if (!Array.isArray(nativeModels) || nativeModels.length === 0) {
    return existing;
  }

  let hasChanges = false;
  const merged = [...existing];

  for (const nativeModel of nativeModels) {
    const modelPath = String(nativeModel?.filePath || '').trim();
    const normalizedPathKey = normalizeModelPathKey(modelPath);

    if (!modelPath || (normalizedPathKey && byPath.has(normalizedPathKey))) {
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
    if (normalizedPathKey) {
      byPath.set(normalizedPathKey, localRecord);
    }
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
      (scan) =>
        scan.syncState === 'synced' ||
        scan.source === 'cloud' ||
        Boolean(scan.remoteId) ||
        Boolean(scan.cloudModelUrl) ||
        Boolean(scan.cloudSyncedAt),
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
    const remoteModelFetchUrl = remoteScan.cloudModelUrl || remoteScan.modelUrl || remoteScan.fileDownloadUrl || '';
    const synced = await upsertLocalScan({
      ...record,
      remoteId: remoteScan.id,
      syncState: 'synced',
      storageLocation: record.modelPath ? 'device' : 'cloud',
      modelUrl: record.modelPath ? record.modelUrl : remoteModelFetchUrl || record.modelUrl,
      fileDownloadUrl: remoteModelFetchUrl || record.fileDownloadUrl,
      cloudSyncedAt: new Date().toISOString(),
      cloudModelUrl: remoteModelFetchUrl,
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

export async function getCachedScans({ tab = 'all', query = '' }: FetchScansInput = {}) {
  const localScans = sortByCapturedAtDesc(await mergeNativeFolderModels());
  const remoteScans = await loadCachedRemoteScans();
  const scans = mergeLocalAndRemoteScans(localScans, remoteScans);
  return byQuery(byTab(scans, tab), query);
}

export async function fetchScans({ tab = 'all', query = '' }: FetchScansInput = {}) {
  const mergedLocal = await mergeNativeFolderModels();
  const localScans = sortByCapturedAtDesc(mergedLocal);

  let remoteScans: ScanRecord[] = [];

  if (getAuthToken()) {
    remoteScans = await loadCachedRemoteScans();

    try {
      const response = await request('/api/scans');
      remoteScans = extractArrayPayload(response).map((scan) => mapBackendScan(scan as Record<string, any>));
      await persistRemoteScans(remoteScans);
    } catch {
      remoteScans = await loadCachedRemoteScans();
    }
  } else {
    remoteScansCache = [];
    remoteScansLoadPromise = null;
    await writeRawRemoteScans([]);
  }

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

  const cachedRemoteScans = await loadCachedRemoteScans();
  const cachedRemoteMatch = cachedRemoteScans.find((scan) => scan.id === scanId || scan.remoteId === scanId);

  if (cachedRemoteMatch) {
    return cachedRemoteMatch;
  }

  const looksLikeLocalOnlyId = scanId.startsWith('local-') || scanId.startsWith('local-native-');

  if (looksLikeLocalOnlyId || !getAuthToken()) {
    return null;
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

  const localScans = await mergeNativeFolderModels();
  const localMatch = localScans.find((item) => item.id === scanId || item.remoteId === scanId);

  if (localMatch?.modelPath) {
    try {
      await deleteNativeSavedModel(localMatch.modelPath);
    } catch {
      return false;
    }
  }

  const removed = await removeLocalScan(scanId);

  if (removed?.remoteId && getAuthToken()) {
    try {
      await request(`/api/scans/${encodeURIComponent(removed.remoteId)}`, {
        method: 'DELETE',
      });
      await removeCachedRemoteScan(removed);
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
    await removeCachedRemoteScan({ id: scanId, remoteId: scanId });
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
    const remoteModelFetchUrl = cloudScan.cloudModelUrl || cloudScan.modelUrl || cloudScan.fileDownloadUrl || '';
    const updated = await upsertLocalScan({
      ...localMatch,
      syncState: 'synced',
      storageLocation: localMatch.modelPath ? 'device' : 'cloud',
      modelUrl: localMatch.modelPath ? localMatch.modelUrl : remoteModelFetchUrl || localMatch.modelUrl,
      fileDownloadUrl: remoteModelFetchUrl || localMatch.fileDownloadUrl,
      cloudSyncedAt: cloudScan.cloudSyncedAt || new Date().toISOString(),
      cloudModelUrl: remoteModelFetchUrl || localMatch.cloudModelUrl,
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
