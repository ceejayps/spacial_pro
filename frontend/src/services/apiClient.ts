import { Capacitor, CapacitorHttp } from '@capacitor/core';

export class ApiRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

function isNativeRuntime() {
  return Capacitor.isNativePlatform();
}

export function resolveApiBaseUrl() {
  const configured = String(import.meta.env.VITE_API_BASE_URL || '').trim();

  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  return 'http://localhost:8080';
}

export function apiUrl(pathValue: string) {
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

function safeJsonParse(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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

function parseNativeErrorMessage(status: number, payload: unknown) {
  const fallback = `Request failed (${status})`;

  if (typeof (payload as { message?: unknown })?.message === 'string' && String((payload as { message?: string }).message).trim()) {
    return String((payload as { message?: string }).message).trim();
  }

  if (typeof payload === 'string' && payload.trim()) {
    return payload.trim();
  }

  return fallback;
}

type ApiRequestInit = {
  method?: string;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  token?: string;
};

export async function requestApi(pathValue: string, init: ApiRequestInit = {}) {
  const url = apiUrl(pathValue);
  const method = String(init.method || 'GET').toUpperCase();
  const token = String(init.token || '').trim();
  const body = init.body ?? null;
  const usesFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers = {
    Accept: 'application/json',
    ...(usesFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers || {}),
  } as Record<string, string>;

  if (isNativeRuntime() && !usesFormData) {
    const rawBody = typeof body === 'string' ? body : '';
    const hasBody = method !== 'GET' && method !== 'HEAD' && body !== null;
    const data = hasBody
      ? typeof body === 'string'
        ? safeJsonParse(rawBody) ?? rawBody
        : body
      : undefined;

    const response = await CapacitorHttp.request({
      url,
      method,
      headers,
      data,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ApiRequestError(parseNativeErrorMessage(response.status, response.data), response.status);
    }

    return response.status === 204 ? null : response.data;
  }

  const response = await fetch(url, {
    method,
    headers,
    body,
  });

  if (!response.ok) {
    throw new ApiRequestError(await parseWebErrorMessage(response), response.status);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}
