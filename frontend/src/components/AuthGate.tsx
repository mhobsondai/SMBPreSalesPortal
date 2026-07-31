import { type ReactNode } from 'react';

import { useCurrentUser } from '../lib/useCurrentUser';
import { useAuthorisation } from '../lib/useAuthorisation';
import { ApiError } from '../lib/api';
import { SignIn } from '../pages/SignIn';
import { AccessDenied } from '../pages/AccessDenied';

interface AuthGateProps {
  children: ReactNode;
}

/**
 * Two gates, in order:
 *
 *   1. Authentication — is anyone signed in? (/.auth/me)
 *   2. Authorisation  — are they one of ours? (/api/me → 403 if not)
 *
 * Both are UX conveniences. The real boundary is `require_auth` in
 * api/shared/auth.py, which every endpoint applies independently.
 *
 * Step 2 exists because this app runs on the Free SWA SKU, where the
 * sign-in page accepts any Microsoft account from any tenant. Without
 * it, an outsider would sign in successfully and then watch the UI
 * throw errors on every data call.
 */
export function AuthGate({ children }: AuthGateProps) {
  const { data: user, isLoading, isError, error } = useCurrentUser();

  const signedIn = Boolean(user);
  const authz = useAuthorisation(signedIn);

  if (isLoading) {
    return <Checking label="Checking sign-in…" />;
  }

  if (isError) {
    return (
      <main className="page">
        <div className="eyebrow">SMB Pre-Sales Portal</div>
        <h1 className="display">Authentication unavailable</h1>
        <p className="lede">
          The sign-in service is not responding. If you are running locally,
          check that the Static Web Apps CLI is started (<code>swa start</code>)
          and that you are on port 4280, not 5173.
        </p>
        <p style={{ color: 'var(--ink-3)', marginTop: 16, fontSize: 13 }}>
          {(error as Error).message}
        </p>
      </main>
    );
  }

  if (!user) {
    return <SignIn />;
  }

  if (authz.isLoading) {
    return <Checking label="Checking access…" />;
  }

  if (authz.isError) {
    const err = authz.error;
    if (err instanceof ApiError && err.status === 403) {
      return <AccessDenied message={err.message} />;
    }

    // Anything else — API down, cold start timeout, misconfigured
    // api_location. Fail closed: do not render the app when we could
    // not confirm authorisation.
    return (
      <main className="page">
        <div className="eyebrow">SMB Pre-Sales Portal</div>
        <h1 className="display">Access check failed</h1>
        <p className="lede">
          We couldn't confirm your access. This usually means the API is
          starting up — wait a few seconds and reload. If it persists, the
          API may not be deployed correctly.
        </p>
        <p style={{ color: 'var(--ink-3)', marginTop: 16, fontSize: 13 }}>
          {(err as Error).message}
        </p>
      </main>
    );
  }

  return <>{children}</>;
}

function Checking({ label }: { label: string }) {
  return (
    <main className="page">
      <p style={{ color: 'var(--ink-3)' }}>{label}</p>
    </main>
  );
}
