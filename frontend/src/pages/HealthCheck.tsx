import { useQuery } from '@tanstack/react-query';

import { TopBar } from '../components/TopBar';
import { getHealth } from '../lib/api';
import { useCurrentUser } from '../lib/useCurrentUser';

/**
 * Diagnostic page — proves the full chain end to end:
 * browser → SWA edge (auth) → Functions API → response.
 * Keep it. It's the fastest way to tell a deployment problem from a
 * code problem.
 */
export function HealthCheck() {
  const { data: user } = useCurrentUser();
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
          <h2>Identity (SWA principal)</h2>
        </div>
        <pre className="diag">{JSON.stringify(user, null, 2)}</pre>

        <div className="section-heading" style={{ marginTop: 40 }}>
          <h2>API (/api/health)</h2>
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
