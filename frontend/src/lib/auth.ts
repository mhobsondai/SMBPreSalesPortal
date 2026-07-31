/**
 * SWA built-in auth — client helper.
 *
 * Azure Static Web Apps terminates the Entra ID (Azure AD) login at the
 * edge and exposes the resulting principal at /.auth/me. The browser
 * never handles the access token directly: SWA sets an encrypted session
 * cookie, validates it on every request, and forwards the identity to the
 * linked Functions API as the `x-ms-client-principal` header.
 *
 * That means:
 *  - no token storage in localStorage / sessionStorage (nothing to steal)
 *  - the API trusts a header the platform injects, not one the client sets
 *  - sign-out is a platform redirect, not a client-side cache clear
 *
 * The SWA CLI emulator returns a mock principal from the same endpoint
 * locally, so this code path is identical in both environments.
 */

export interface ClientPrincipal {
  identityProvider: string;
  userId: string;
  userDetails: string;
  userRoles: string[];
  claims?: Array<{ typ: string; val: string }>;
}

interface AuthResponse {
  clientPrincipal: ClientPrincipal | null;
}

export async function fetchCurrentUser(): Promise<ClientPrincipal | null> {
  const response = await fetch('/.auth/me');

  if (!response.ok) {
    // /.auth/me always returns 200 when SWA auth is configured. A non-OK
    // response means the platform isn't routing the request — usually the
    // SWA CLI isn't running locally.
    throw new Error(`Auth endpoint returned ${response.status}`);
  }

  const data = (await response.json()) as AuthResponse;
  return data.clientPrincipal;
}

export function loginUrl(returnTo: string = window.location.pathname): string {
  const encoded = encodeURIComponent(returnTo);
  return `/.auth/login/aad?post_login_redirect_uri=${encoded}`;
}

export function logoutUrl(returnTo: string = '/'): string {
  const encoded = encodeURIComponent(returnTo);
  return `/.auth/logout?post_logout_redirect_uri=${encoded}`;
}
