import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { ApiRequestError, requestApi } from './apiClient';

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  createdAt?: string;
  updatedAt?: string;
};

export type AuthPayload = {
  accessToken: string;
  tokenType: string;
  user: AuthUser;
};

const AUTH_TOKEN_KEY = 'lidarpro.auth.accessToken.v1';
const AUTH_USER_KEY = 'lidarpro.auth.user.v1';
const AUTH_CHANGED_EVENT = 'lidarpro.auth.changed';

let memoryAuthToken = '';
let memoryAuthUser: AuthUser | null = null;
let memoryHydrated = false;
let authHydrationPromise: Promise<void> | null = null;

function isNativeRuntime() {
  return Capacitor.isNativePlatform();
}

function safeJsonParse(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeUser(raw: unknown): AuthUser {
  const user = (raw && typeof raw === 'object' ? raw : {}) as Partial<AuthUser>;

  return {
    id: String(user.id || ''),
    email: String(user.email || ''),
    fullName: String(user.fullName || ''),
    createdAt: user.createdAt ? String(user.createdAt) : '',
    updatedAt: user.updatedAt ? String(user.updatedAt) : '',
  };
}

function normalizeAuthPayload(raw: unknown): AuthPayload {
  const payload = (raw && typeof raw === 'object' ? raw : {}) as Partial<AuthPayload>;

  return {
    accessToken: String(payload.accessToken || ''),
    tokenType: String(payload.tokenType || 'Bearer'),
    user: normalizeUser(payload.user),
  };
}

async function request(pathValue: string, init: RequestInit = {}, token?: string) {
  return requestApi(pathValue, {
    method: init.method,
    body: init.body,
    headers: (init.headers || {}) as Record<string, string>,
    token,
  });
}

function hydrateMemoryCacheFromWebStorage() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    memoryAuthToken = String(window.localStorage.getItem(AUTH_TOKEN_KEY) || '').trim();
  } catch {
    memoryAuthToken = '';
  }

  try {
    const parsed = safeJsonParse(window.localStorage.getItem(AUTH_USER_KEY));
    memoryAuthUser = parsed && typeof parsed === 'object' ? normalizeUser(parsed) : null;
  } catch {
    memoryAuthUser = null;
  }
}

async function readNativeAuthFromPreferences() {
  try {
    const [{ value: token }, { value: userJson }] = await Promise.all([
      Preferences.get({ key: AUTH_TOKEN_KEY }),
      Preferences.get({ key: AUTH_USER_KEY }),
    ]);

    memoryAuthToken = String(token || '').trim();

    const parsed = safeJsonParse(userJson || null);
    memoryAuthUser = parsed && typeof parsed === 'object' ? normalizeUser(parsed) : null;
  } catch {
    memoryAuthToken = '';
    memoryAuthUser = null;
  }
}

function emitAuthChanged() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
}

export function authChangedEventName() {
  return AUTH_CHANGED_EVENT;
}

export async function hydrateAuthSession() {
  if (memoryHydrated) {
    return;
  }

  if (!authHydrationPromise) {
    authHydrationPromise = (async () => {
      if (isNativeRuntime()) {
        await readNativeAuthFromPreferences();
      } else {
        hydrateMemoryCacheFromWebStorage();
      }

      memoryHydrated = true;
    })().finally(() => {
      authHydrationPromise = null;
    });
  }

  await authHydrationPromise;
}

export function getAuthToken() {
  if (typeof window === 'undefined') {
    return '';
  }

  if (!memoryHydrated) {
    if (isNativeRuntime()) {
      void hydrateAuthSession();
    } else {
      hydrateMemoryCacheFromWebStorage();
      memoryHydrated = true;
    }
  }

  return memoryAuthToken;
}

export function getStoredAuthUser() {
  if (typeof window === 'undefined') {
    return null;
  }

  if (!memoryHydrated) {
    if (isNativeRuntime()) {
      void hydrateAuthSession();
    } else {
      hydrateMemoryCacheFromWebStorage();
      memoryHydrated = true;
    }
  }

  return memoryAuthUser;
}

export function persistAuthSession(payload: AuthPayload) {
  if (typeof window === 'undefined') {
    return;
  }

  const normalized = normalizeAuthPayload(payload);

  memoryHydrated = true;
  memoryAuthToken = normalized.accessToken;
  memoryAuthUser = normalized.user;

  try {
    window.localStorage.setItem(AUTH_TOKEN_KEY, normalized.accessToken);
    window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(normalized.user));
  } catch {
    // Memory cache remains the fallback if storage is unavailable.
  }

  if (isNativeRuntime()) {
    void Promise.all([
      Preferences.set({ key: AUTH_TOKEN_KEY, value: normalized.accessToken }),
      Preferences.set({ key: AUTH_USER_KEY, value: JSON.stringify(normalized.user) }),
    ]);
  }

  emitAuthChanged();
}

export function clearAuthSession() {
  if (typeof window === 'undefined') {
    return;
  }

  memoryHydrated = true;
  memoryAuthToken = '';
  memoryAuthUser = null;

  try {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
    window.localStorage.removeItem(AUTH_USER_KEY);
  } catch {
    // Ignore storage cleanup failures after clearing memory state.
  }

  if (isNativeRuntime()) {
    void Promise.all([
      Preferences.remove({ key: AUTH_TOKEN_KEY }),
      Preferences.remove({ key: AUTH_USER_KEY }),
    ]);
  }

  emitAuthChanged();
}

export async function registerUser(input: { fullName: string; email: string; password: string }) {
  const payload = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  const normalized = normalizeAuthPayload(payload);
  persistAuthSession(normalized);
  return normalized;
}

export async function loginUser(input: { email: string; password: string }) {
  const payload = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  const normalized = normalizeAuthPayload(payload);
  persistAuthSession(normalized);
  return normalized;
}

export async function fetchCurrentUser(token = getAuthToken()) {
  if (!token) {
    return null;
  }

  const payload = await request(
    '/api/auth/me',
    {
      method: 'GET',
    },
    token,
  );

  const user = normalizeUser(payload);
  memoryAuthUser = user;

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    } catch {
      // Keep the refreshed user only in memory if storage is unavailable.
    }
  }

  if (isNativeRuntime()) {
    void Preferences.set({ key: AUTH_USER_KEY, value: JSON.stringify(user) });
  }

  return user;
}

export function isAuthError(error: unknown) {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403);
}
