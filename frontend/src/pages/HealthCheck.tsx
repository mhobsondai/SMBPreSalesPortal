import { useQuery } from '@tanstack/react-query';

import { TopBar } from '../components/TopBar';
import { getHealth } from '../lib/api';
import { useCurrentUser } from '../lib/useCurrentUser';
import { useAuthorisation } from '../lib/useAuthorisation';

/**
 * Diagnostic page — proves the full chain end to end:
 * browser → SWA edge (auth) → Functions API → response.
 * The fastest way to tell a deployment problem from a code problem.
 */
export function HealthCheck() {
  const { data: user } = useCurrentUser();
  const authz = useAuthorisation(true);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    retry: false
  });

  return (
    <>
      <TopBar links={[{ label: 'All areas', to: '/' }]} />
      <main className="page">
        <div className="eyebrow">Diagnostics</div>
        <h1 className="display">Health <em>check</em></h1>

        <div className="section-heading" style={{ marginTop: 40 }}>
          <h2>1 · SWA principal (/.auth/me)</h2>
        </div>
        <pre className="diag">{JSON.stringify(user, null, 2)}</pre>

        <div className="section-heading" style={{ marginTop: 40 }}>
          <h2>2 · Authorisation (/api/me)</h2>
        </div>
        {authz.data && <AuthzVerdict reason={authz.data.authorised_by} />}
        <pre className="diag">
          {authz.isLoading
            ? 'Checking…'
            : authz.isError
              ? `DENIED — ${(authz.error as Error).message}`
              : JSON.stringify(authz.data, null, 2)}
        </pre>

        <div className="section-heading" style={{ marginTop: 40 }}>
          <h2>3 · API liveness (/api/health)</h2>
        </div>
        <pre className="diag">
          {isLoading
            ? 'Checking…'
            : isError
              ? `FAILED — ${(error as Error).message}`
              : JSON.stringify(data, null, 2)}
        </pre>
      </main>
    </>
  );
}

/**
 * Plain-English reading of the authorisation reason, so the decision in
 * AD-07 follow-up 2 doesn't require squinting at JSON.
 */
function AuthzVerdict({ reason }: { reason: string }) {
  const byTenant = reason.startsWith('tenant:');
  return (
    <p
      className="verdict"
      style={{
        borderLeftColor: byTenant ? 'var(--green)' : 'var(--amber)',
        background: byTenant ? 'var(--green-bg)' : 'var(--amber-bg)',
        color: byTenant ? 'var(--green-text)' : 'var(--amber-text)'
      }}
    >
      {byTenant ? (
        <>
          <strong>Tenant claim present.</strong> Authorised by tenant ID, not
          email domain. The domain fallback in <code>check_organisation</code>{' '}
          is redundant and can be removed — see AD-07 follow-up 2.
        </>
      ) : (
        <>
          <strong>No tenant claim.</strong> Authorised by email domain. The
          fallback is load-bearing — removing it would deny every user,
          including you. Leave it in place.
        </>
      )}
    </p>
  );
}
