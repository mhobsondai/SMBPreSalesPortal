/**
 * Thin API client.
 *
 * All calls are same-origin and rely on the SWA session cookie for
 * authentication — no Authorization header is constructed client-side.
 * Routes under /api/* are gated to `authenticated` in
 * staticwebapp.config.json, so an expired session yields a 401 which the
 * platform turns into a login redirect.
 */

export interface CurrentUser {
  user_id: string;
  upn: string;
  display_name: string;
  roles: string[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });

  if (response.status === 401) {
    throw new Error('Session expired — please sign in again.');
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${response.status} ${response.statusText}${body ? `: ${body}` : ''}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function getCurrentUser(): Promise<CurrentUser> {
  return request<CurrentUser>('/api/me');
}

export function getHealth(): Promise<{ status: string; version: string; timestamp: string }> {
  return request('/api/health');
}
