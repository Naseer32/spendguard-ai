// Minimal HTTP client for the SpendGuard backend.
//
// Contract (backend/src/app.js): every success is { data }, every failure is
// { error: { code, message, field? }, data? }. Owner routes need
// "Authorization: Bearer <OWNER_TOKEN>". Authentication is a header, never a
// cookie, so requests are sent with credentials omitted.
//
// The owner token is read through `getToken()` on every call and is never
// stored, logged or included in an error.

import { ApiError } from './errors.js';

const DEFAULT_TIMEOUT_MS = 15_000;

function buildUrl(baseUrl, path, query) {
  if (typeof path !== 'string' || !path.startsWith('/api/') || path.includes('..') || /[\s?#]/.test(path)) {
    throw new ApiError('config', 'Invalid API path.');
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return `${baseUrl}${path}${qs ? `?${qs}` : ''}`;
}

async function readJson(response) {
  const text = await response.text();
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined; // not JSON
  }
}

function kindForStatus(status) {
  if (status === 401) return 'auth';
  if (status === 429) return 'rate';
  return status >= 500 ? 'server' : 'client';
}

/**
 * createApiClient({ baseUrl, getToken, fetchImpl, timeoutMs })
 *   baseUrl: '' (same origin) or a validated origin
 *   request({ method, path, query, body, auth }) resolves with `data`
 */
export function createApiClient({
  baseUrl = '',
  getToken = () => null,
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  async function request({ method = 'GET', path, query, body, auth = 'owner' }) {
    const url = buildUrl(baseUrl, path, query);
    const headers = { Accept: 'application/json' };
    if (auth === 'owner') {
      const token = getToken();
      if (typeof token !== 'string' || token === '') {
        throw new ApiError('auth', 'Not connected: no owner token.');
      }
      headers.Authorization = `Bearer ${token}`;
    }
    const init = {
      method,
      headers,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error', // never follow a redirect with the token attached
      referrerPolicy: 'no-referrer',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new ApiError('timeout', 'The request timed out.');
      }
      throw new ApiError('network', 'The backend could not be reached.');
    } finally {
      clearTimeout(timer);
    }

    const payload = await readJson(response);
    if (response.ok) {
      if (payload === undefined || payload === null || typeof payload !== 'object' || !('data' in payload)) {
        throw new ApiError('shape', 'The response was not in the expected format.', { status: response.status });
      }
      return payload.data;
    }

    const err = payload && typeof payload === 'object' && payload.error && typeof payload.error === 'object' ? payload.error : {};
    const retry = Number.parseInt(response.headers?.get?.('Retry-After') ?? '', 10);
    throw new ApiError(kindForStatus(response.status), typeof err.message === 'string' ? err.message : `Request failed (${response.status}).`, {
      status: response.status,
      code: typeof err.code === 'string' ? err.code : null,
      field: typeof err.field === 'string' ? err.field : null,
      retryAfter: Number.isInteger(retry) && retry > 0 ? retry : null,
      data: payload && typeof payload === 'object' && 'data' in payload ? payload.data : null,
    });
  }

  return Object.freeze({ request, baseUrl });
}
