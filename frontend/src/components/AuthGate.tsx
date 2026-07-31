import { type ReactNode } from 'react';

import { useCurrentUser } from '../lib/useCurrentUser';
import { SignIn } from '../pages/SignIn';

interface AuthGateProps {
  children: ReactNode;
}

/**
 * AuthGate — resolves the SWA principal before rendering any route.
 *
 * This is a UX boundary, not a security boundary. The real enforcement is
 * server-side: /api/* is restricted to `authenticated` in
 * staticwebapp.config.json, and the Functions API independently validates
 * the x-ms-client-principal header on every request. A hostile client can
 * bypass this component; it cannot bypass those.
 */
export function AuthGate({ children }: AuthGateProps) {
  const { data: user, isLoading, isError, error } = useCurrentUser();

  if (isLoading) {
    return (
      <main className="page">
        <p style={{ color: 'var(--ink-3)' }}>Checking sign-in&hellip;</p>
      </main>
    );
  }

  if (isError) {
    return (
      <main className="page">
        <div className="eyebrow">SMB Pre-Sales Portal</div>
        <h1 className="display">Authentication unavailable</h1>
        <p className="lede">
          The sign-in service is not responding. If you are running locally,
          check that the Static Web Apps CLI is started (<code>swa start</code>).
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

  return <>{children}</>;
}
