import { Link } from 'react-router-dom';

import {
  countAllTiles,
  countLiveTiles,
  sectionHref,
  type Section
} from '../config/navigation';
import './SectionGrid.css';

interface SectionGridProps {
  sections: Section[];
  /** Trail of the *parent*, so child hrefs can be built. */
  parentTrail: Section[];
}

/**
 * Practice-area cards for the landing page.
 *
 * Only top-level sections are rendered as cards. Sub-sections render
 * inline on the practice-area page as lists — see ToolList and
 * config/navigation.ts for why.
 */
export function SectionGrid({ sections, parentTrail }: SectionGridProps) {
  return (
    <div className="section-grid">
      {sections.map((section, index) => (
        <SectionCard
          key={section.slug}
          section={section}
          index={index}
          href={sectionHref([...parentTrail, section])}
        />
      ))}
    </div>
  );
}

function SectionCard({
  section,
  index,
  href
}: {
  section: Section;
  index: number;
  href: string;
}) {
  const live = countLiveTiles(section);
  const total = countAllTiles(section);
  const subsections = section.children?.length ?? 0;

  // Prefer the most informative true statement: available tools if any
  // exist, otherwise the shape of what's coming.
  const meta =
    live > 0
      ? `${live} tool${live === 1 ? '' : 's'} available`
      : subsections > 0
        ? `${subsections} section${subsections === 1 ? '' : 's'}`
        : total > 0
          ? 'In development'
          : 'Coming soon';

  return (
    <Link
      to={href}
      className={`section-card reveal reveal-${Math.min(index + 2, 5)}`}
    >
      <div className="section-card-index">{String(index + 1).padStart(2, '0')}</div>
      <h3 className="section-card-title">{section.name}</h3>
      <p className="section-card-desc">{section.summary}</p>
      <div className="section-card-foot">
        <span className="section-card-meta">{meta}</span>
        <span className="section-card-arrow" aria-hidden="true">→</span>
      </div>
    </Link>
  );
}
