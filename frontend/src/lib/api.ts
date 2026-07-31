/**
 * Thin API client.
 *
 * All calls are same-origin and rely on the SWA session cookie — no
 * Authorization header is constructed client-side.
 *
 * Two distinct failure modes matter here and must not be conflated:
 *   401 — not signed in            → send the user to login
 *   403 — signed in, not one of us → show the access-denied screen
 *
 * On the Free SKU the second case is routine, not exotic: the sign-in
 * page accepts any Microsoft account, so anyone outside Codestone who
 * reaches the URL will land in exactly this state.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface CurrentUser {
  user_id: string;
  upn: string;
  display_name: string;
  roles: string[];
  identity_provider: string;
  /**
   * Why the server allowed this caller — "tenant:<guid>" or
   * "domain:<domain>". Diagnostic only; the decision has already been
   * enforced server-side. Surfaced on /health so the email-domain
   * fallback can be retired safely. See docs/decisions.md AD-07.
   */
  authorised_by: string;
  tenant_claim_present: boolean;
  claim_count: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    let code = 'http_error';
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      code = body.error ?? code;
      message = body.message ?? message;
    } catch {
      /* non-JSON error body — keep the status text */
    }
    throw new ApiError(response.status, code, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function getCurrentUser(): Promise<CurrentUser> {
  return request<CurrentUser>('/api/me');
}

export function getHealth(): Promise<{
  status: string;
  version: string;
  timestamp: string;
  authenticated_as: string;
}> {
  return request('/api/health');
}
