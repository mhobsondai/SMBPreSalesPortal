import { Link } from 'react-router-dom';

import { TopBar } from '../components/TopBar';
import { useCurrentUser } from '../lib/useCurrentUser';
import { PRACTICE_AREAS } from '../config/practices';
import { APP_VERSION } from '../config/app';
import './Landing.css';

export function Landing() {
  const { data: user, isLoading } = useCurrentUser();
  const firstName = user?.displayName?.split(' ')[0] ?? (isLoading ? '…' : 'there');

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="landing-header reveal reveal-1">
          <div>
            <div className="eyebrow">SMB Pre-Sales Portal · {APP_VERSION}</div>
            <h1 className="display">
              Welcome, <em>{firstName}</em>.
            </h1>
            <p className="lede">
              Pre-sales tooling for the SMB practice. Choose an area to see the
              tools available to you.
            </p>
          </div>
        </section>

        <div className="section-heading reveal reveal-2">
          <h2>Practice areas</h2>
          <span className="section-meta">{PRACTICE_AREAS.length} areas</span>
        </div>

        <div className="area-grid">
          {PRACTICE_AREAS.map((area, index) => {
            const liveCount = area.tiles.filter((t) => t.status === 'live').length;
            return (
              <Link
                key={area.slug}
                to={`/area/${area.slug}`}
                className={`area-card reveal reveal-${Math.min(index + 2, 5)}`}
              >
                <div className="area-card-index">
                  {String(index + 1).padStart(2, '0')}
                </div>
                <h3 className="area-card-title">{area.name}</h3>
                <p className="area-card-desc">{area.summary}</p>
                <div className="area-card-foot">
                  <span className="area-card-count">
                    {liveCount > 0
                      ? `${liveCount} tool${liveCount === 1 ? '' : 's'} available`
                      : 'Coming soon'}
                  </span>
                  <span className="area-card-arrow" aria-hidden="true">→</span>
                </div>
              </Link>
            );
          })}
        </div>
      </main>

      <footer className="page-footer">
        SMB Pre-Sales Portal · {APP_VERSION} · Codestone internal use only
      </footer>
    </>
  );
}
