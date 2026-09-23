/**
 * Тонкая обёртка над fetch: всегда шлёт cookie сессии (credentials: 'include'),
 * next.config.ts проксирует /api/* на бэкенд — поэтому same-origin и в dev, и в проде.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T;
  return body;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, payload?: unknown) => request<T>(path, { method: 'POST', body: payload ? JSON.stringify(payload) : undefined }),
};

export type ApiResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
