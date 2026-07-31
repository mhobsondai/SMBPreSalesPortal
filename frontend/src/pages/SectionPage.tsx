import { Link, useParams } from 'react-router-dom';

import { TopBar } from '../components/TopBar';
import { ToolList } from '../components/ToolList';
import { Breadcrumbs } from '../components/Breadcrumbs';
import {
  countAllTiles,
  countLiveTiles,
  resolvePath,
  type Section
} from '../config/navigation';
import { APP_VERSION } from '../config/app';
import './SectionPage.css';

/**
 * Renders a practice area — and every group of tools within it — on a
 * single page.
 *
 * Sub-sections are rendered inline as headed lists rather than as links
 * to further pages. One click from the landing page reaches any tool.
 *
 * A section with no children but its own tiles (Infrastructure, ERP
 * today) renders as a single group, so the layout is identical whether
 * or not a practice area has been broken into groups yet.
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
  const depthLabel = trail.length === 1 ? 'Practice area' : trail[0].name;

  // Normalise to a list of groups so the layout has one shape. A section
  // holding tiles directly becomes a group in its own right.
  const groups: Section[] = section.children?.length
    ? section.children
    : [section];

  const totalTools = countAllTiles(section);
  const liveTools = countLiveTiles(section);

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
            <div>
              <strong>{totalTools}</strong> tool{totalTools === 1 ? '' : 's'}
            </div>
            <div>
              <strong>{liveTools}</strong> live
            </div>
            <div>
              <strong>{APP_VERSION}</strong>
            </div>
          </div>
        </section>

        {totalTools === 0 ? (
          <div className="empty">
            <div className="empty-icon" aria-hidden="true">∅</div>
            <h3>Nothing here yet</h3>
            <p>
              This area has no tools. <Link to="/">Return to the portal home</Link>.
            </p>
          </div>
        ) : (
          <div className="tool-groups">
            {groups.map((group, index) => (
              <div
                key={group.slug}
                className={`reveal reveal-${Math.min(index + 2, 5)}`}
              >
                <ToolList section={group} />
              </div>
            ))}
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
