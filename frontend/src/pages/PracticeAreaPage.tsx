import { Link, useParams } from 'react-router-dom';

import { TopBar } from '../components/TopBar';
import { TileGrid } from '../components/TileGrid';
import { findPracticeArea } from '../config/practices';
import { APP_VERSION } from '../config/app';
import './PracticeAreaPage.css';

/**
 * One component serves all three practice areas. The content comes from
 * config/practices.ts, so adding an area or a tile never requires a new
 * page component or route.
 */
export function PracticeAreaPage() {
  const { slug } = useParams<{ slug: string }>();
  const area = findPracticeArea(slug);

  if (!area) {
    return (
      <>
        <TopBar />
        <main className="page">
          <div className="eyebrow">Not found</div>
          <h1 className="display">No such practice area</h1>
          <p className="lede">
            The link you followed doesn't match a known area.{' '}
            <Link to="/">Return to the portal home</Link>.
          </p>
        </main>
      </>
    );
  }

  const [headA, headB] = area.headline;

  return (
    <>
      <TopBar links={[{ label: 'All areas', to: '/' }]} />

      <main className="page">
        <nav className="crumbs reveal reveal-1" aria-label="Breadcrumb">
          <Link to="/">Portal</Link>
          <span aria-hidden="true">/</span>
          <span>{area.name}</span>
        </nav>

        <section className="area-header reveal reveal-1">
          <div>
            <div className="eyebrow">Practice area</div>
            <h1 className="display">
              {headA} {headB && <em>{headB}</em>}
            </h1>
            <p className="lede">{area.summary}</p>
          </div>
          <div className="area-header-meta">
            <div>
              <strong>{area.tiles.length}</strong> tool
              {area.tiles.length === 1 ? '' : 's'}
            </div>
            <div>
              <strong>{APP_VERSION}</strong>
            </div>
          </div>
        </section>

        <div className="section-heading reveal reveal-2">
          <h2>Tools</h2>
        </div>

        <TileGrid tiles={area.tiles} />
      </main>

      <footer className="page-footer">
        SMB Pre-Sales Portal · {APP_VERSION} · Codestone internal use only
      </footer>
    </>
  );
}
