import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { ApiRequestError, getAuthToken } from './authService';

export type ScanAnnotation = {
  id?: string;
  text?: string;
  position?: {
    x?: number;
    y?: number;
    z?: number;
  };
  source?: string;
  confidence?: number;
};

export type ScanRecord = {
  id: string;
  title: string;
  capturedAt?: string;
  status?: string;
  progress?: number;
  modelUrl?: string;
  fileDownloadUrl?: string;
  modelFormat?: string;
  fileSizeBytes?: number;
  vertexCount?: number;
  faceCount?: number;
  pointsCaptured?: number;
  scanQuality?: number;
  estimatedAccuracyMm?: number;
  arEngine?: string;
  source?: string;
  storageLocation?: string;
  syncState?: string;
  cloudModelUrl?: string;
  cloudSyncedAt?: string;
  annotations?: ScanAnnotation[];
  extraMetadata?: Record<string, unknown>;
  originalFilename?: string;
  contentType?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CreateScanMetadata = {
  title?: string;
  capturedAt?: string;
  modelFormat?: 'obj' | 'glb' | 'gltf' | string;
  status?: string;
  syncState?: string;
  source?: string;
  storageLocation?: string;
  pointsCaptured?: number;
  vertexCount?: number;
  faceCount?: number;
  scanQuality?: number;
  estimatedAccuracyMm?: number;
  arEngine?: string;
  annotations?: ScanAnnotation[];
  extraMetadata?: Record<string, unknown>;
};

export type UpdateScanInput = {
  annotations: ScanAnnotation[];
  extraMetadata?: Record<string, unknown>;
};

const DEFAULT_API_BASE_URL = 'http://localhost:8080';

function isNativeRuntime() {
  return Capacitor.isNativePlatform();
}

function resolveApiBaseUrl() {
  const configured = String(import.meta.env.VITE_API_BASE_URL || '').trim();

  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  return DEFAULT_API_BASE_URL;
}

function apiUrl(pathValue: string) {
  const base = resolveApiBaseUrl();
  const path = String(pathValue || '').trim();

  if (!path) {
    return base;
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
}

function toAbsoluteUrl(value: string | undefined) {
  const raw = String(value || '').trim();

  if (!raw) {
    return '';
  }

  if (/^(https?:|file:|blob:|capacitor:|ionic:)/i.test(raw)) {
    return raw;
  }

  if (raw.startsWith('/')) {
    return `${resolveApiBaseUrl()}${raw}`;
  }

  return `${resolveApiBaseUrl()}/${raw}`;
}

function normalizeAnnotation(raw: unknown, index: number): ScanAnnotation {
  const annotation = (raw && typeof raw === 'object' ? raw : {}) as ScanAnnotation;
  const position = annotation.position || {};

  return {
    id: annotation.id ? String(annotation.id) : `annotation-${index + 1}`,
    text: annotation.text ? String(annotation.text) : '',
    position: {
      x: Number(position.x || 0),
      y: Number(position.y || 0),
      z: Number(position.z || 0),
    },
    source: annotation.source ? String(annotation.source) : undefined,
    confidence:
      typeof annotation.confidence === 'number' ? annotation.confidence : annotation.confidence ? Number(annotation.confidence) : undefined,
  };
}

function normalizeAnnotations(raw: unknown) {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((annotation, index) => normalizeAnnotation(annotation, index));
}

function normalizeScanRecord(raw: unknown): ScanRecord {
  const scan = (raw && typeof raw === 'object' ? raw : {}) as Partial<ScanRecord>;

  return {
    id: String(scan.id || ''),
    title: String(scan.title || 'Captured Scan'),
    capturedAt: scan.capturedAt ? String(scan.capturedAt) : '',
    status: scan.status ? String(scan.status) : '',
    progress: typeof scan.progress === 'number' ? scan.progress : Number(scan.progress || 0),
    modelUrl: toAbsoluteUrl(scan.modelUrl),
    fileDownloadUrl: toAbsoluteUrl(scan.fileDownloadUrl || scan.modelUrl),
    modelFormat: scan.modelFormat ? String(scan.modelFormat) : '',
    fileSizeBytes: typeof scan.fileSizeBytes === 'number' ? scan.fileSizeBytes : Number(scan.fileSizeBytes || 0),
    vertexCount: typeof scan.vertexCount === 'number' ? scan.vertexCount : Number(scan.vertexCount || 0),
    faceCount: typeof scan.faceCount === 'number' ? scan.faceCount : Number(scan.faceCount || 0),
    pointsCaptured: typeof scan.pointsCaptured === 'number' ? scan.pointsCaptured : Number(scan.pointsCaptured || 0),
    scanQuality: typeof scan.scanQuality === 'number' ? scan.scanQuality : Number(scan.scanQuality || 0),
    estimatedAccuracyMm:
      typeof scan.estimatedAccuracyMm === 'number' ? scan.estimatedAccuracyMm : Number(scan.estimatedAccuracyMm || 0),
    arEngine: scan.arEngine ? String(scan.arEngine) : '',
    source: scan.source ? String(scan.source) : '',
    storageLocation: scan.storageLocation ? String(scan.storageLocation) : '',
    syncState: scan.syncState ? String(scan.syncState) : '',
    cloudModelUrl: toAbsoluteUrl(scan.cloudModelUrl),
    cloudSyncedAt: scan.cloudSyncedAt ? String(scan.cloudSyncedAt) : '',
    annotations: normalizeAnnotations(scan.annotations),
    extraMetadata:
      scan.extraMetadata && typeof scan.extraMetadata === 'object' ? (scan.extraMetadata as Record<string, unknown>) : {},
    originalFilename: scan.originalFilename ? String(scan.originalFilename) : '',
    contentType: scan.contentType ? String(scan.contentType) : '',
    createdAt: scan.createdAt ? String(scan.createdAt) : '',
    updatedAt: scan.updatedAt ? String(scan.updatedAt) : '',
  };
}

async function parseWebErrorMessage(response: Response) {
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

async function requestJson<T>(pathValue: string, init: RequestInit = {}) {
  const token = getAuthToken();
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers || {}),
  } as Record<string, string>;

  if (isNativeRuntime()) {
    const rawBody = init.body ? String(init.body) : '';
    const data = rawBody ? JSON.parse(rawBody) : undefined;
    const response = await CapacitorHttp.request({
      url: apiUrl(pathValue),
      method: String(init.method || 'GET').toUpperCase(),
      headers,
      data,
    });

    if (response.status < 200 || response.status >= 300) {
      const fallback = `Request failed (${response.status})`;
      const message =
        typeof response.data?.message === 'string' && response.data.message.trim()
          ? response.data.message
          : typeof response.data === 'string' && response.data.trim()
            ? response.data
            : fallback;

      throw new ApiRequestError(message, response.status);
    }

    return (response.status === 204 ? null : response.data) as T;
  }

  const response = await fetch(apiUrl(pathValue), {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new ApiRequestError(await parseWebErrorMessage(response), response.status);
  }

  return (response.status === 204 ? null : await response.json()) as T;
}

async function uploadMultipart<T>(pathValue: string, formData: FormData) {
  const token = getAuthToken();

  const response = await fetch(apiUrl(pathValue), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  if (!response.ok) {
    throw new ApiRequestError(await parseWebErrorMessage(response), response.status);
  }

  return (await response.json()) as T;
}

export async function fetchScans() {
  const response = await requestJson<unknown[]>('/api/scans', {
    method: 'GET',
  });

  return Array.isArray(response) ? response.map(normalizeScanRecord) : [];
}

export async function getScanById(scanId: string) {
  const response = await requestJson<unknown>(`/api/scans/${encodeURIComponent(scanId)}`, {
    method: 'GET',
  });

  return normalizeScanRecord(response);
}

export async function createScan(input: { file: File | Blob; metadata: CreateScanMetadata; fileName?: string }) {
  const formData = new FormData();
  const fileName = String(input.fileName || (input.file instanceof File ? input.file.name : `scan-${Date.now()}.${input.metadata.modelFormat || 'glb'}`));

  formData.append('file', input.file, fileName);
  formData.append('metadata', JSON.stringify(input.metadata || {}));

  const response = await uploadMultipart<unknown>('/api/scans', formData);
  return normalizeScanRecord(response);
}

export async function updateScan(scanId: string, input: UpdateScanInput) {
  const response = await requestJson<unknown>(`/api/scans/${encodeURIComponent(scanId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      annotations: normalizeAnnotations(input.annotations),
      ...(input.extraMetadata ? { extraMetadata: input.extraMetadata } : {}),
    }),
  });

  return normalizeScanRecord(response);
}

export async function deleteScan(scanId: string) {
  await requestJson<null>(`/api/scans/${encodeURIComponent(scanId)}`, {
    method: 'DELETE',
  });
}

export async function syncScan(scanId: string) {
  const response = await requestJson<unknown>(`/api/scans/${encodeURIComponent(scanId)}/sync`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  return normalizeScanRecord(response);
}
