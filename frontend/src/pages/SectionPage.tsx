import { Link, useParams } from 'react-router-dom';

import { TopBar } from '../components/TopBar';
import { TileGrid } from '../components/TileGrid';
import { SectionGrid } from '../components/SectionGrid';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { countAllTiles, resolvePath, type Section } from '../config/navigation';
import { APP_VERSION } from '../config/app';
import './SectionPage.css';

/**
 * One component renders every section at every depth.
 *
 * The route is a splat (`/area/*`), so the path is resolved against the
 * navigation tree at render time rather than being enumerated in the
 * router. Adding a level of nesting is a config change only.
 *
 * A section can show sub-sections, tools, or both. Sub-sections come
 * first — they're the coarser choice, and a reader scanning the page
 * should see the structure before the leaves.
 */
export function SectionPage() {
  const params = useParams();
  const segments = (params['*'] ?? '').split('/').filter(Boolean);
  const resolved = resolvePath(segments);

  if (!resolved) {
    return <UnknownSection />;
  }

  const { section, trail } = resolved;
  const [headA, headB] = section.headline;
  const parentTrail = trail.slice(0, -1);
  const depthLabel = trail.length === 1 ? 'Practice area' : trail[0].name;

  const hasChildren = (section.children?.length ?? 0) > 0;
  const hasTiles = (section.tiles?.length ?? 0) > 0;

  return (
    <>
      <TopBar links={[{ label: 'All areas', to: '/' }]} />

      <main className="page">
        <Breadcrumbs trail={trail} />

        <section className="section-header reveal reveal-1">
          <div>
            <div className="eyebrow">{depthLabel}</div>
            <h1 className="display">
              {headA} {headB && <em>{headB}</em>}
            </h1>
            <p className="lede">{section.summary}</p>
          </div>
          <div className="section-header-meta">
            {hasChildren && (
              <div>
                <strong>{section.children?.length}</strong> section
                {section.children?.length === 1 ? '' : 's'}
              </div>
            )}
            <div>
              <strong>{countAllTiles(section)}</strong> tool
              {countAllTiles(section) === 1 ? '' : 's'}
            </div>
            <div>
              <strong>{APP_VERSION}</strong>
            </div>
          </div>
        </section>

        {hasChildren && (
          <>
            <div className="section-heading reveal reveal-2">
              <h2>Sections</h2>
            </div>
            <SectionGrid
              sections={section.children as Section[]}
              parentTrail={trail}
              variant="nested"
            />
          </>
        )}

        {hasTiles && (
          <>
            <div
              className="section-heading reveal reveal-2"
              style={{ marginTop: hasChildren ? 60 : undefined }}
            >
              <h2>Tools</h2>
            </div>
            <TileGrid tiles={section.tiles ?? []} />
          </>
        )}

        {!hasChildren && !hasTiles && (
          <div className="empty">
            <div className="empty-icon" aria-hidden="true">∅</div>
            <h3>Nothing here yet</h3>
            <p>
              This section has no tools or sub-sections.{' '}
              <Link to={parentTrail.length ? `/area/${parentTrail.map((s) => s.slug).join('/')}` : '/'}>
                Go back
              </Link>
              .
            </p>
          </div>
        )}
      </main>

      <footer className="page-footer">
        SMB Pre-Sales Portal · {APP_VERSION} · Codestone internal use only
      </footer>
    </>
  );
}

function UnknownSection() {
  return (
    <>
      <TopBar />
      <main className="page">
        <div className="eyebrow">Not found</div>
        <h1 className="display">No such section</h1>
        <p className="lede">
          The link you followed doesn't match anything in the portal. It may
          have been renamed since it was bookmarked.{' '}
          <Link to="/">Return to the portal home</Link>.
        </p>
      </main>
    </>
  );
}
