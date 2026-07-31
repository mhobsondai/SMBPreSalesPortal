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
  /**
   * Top-level sections get the heavier charcoal treatment on the landing
   * page; nested ones use the lighter card so the hierarchy reads at a
   * glance rather than requiring the breadcrumb.
   */
  variant?: 'primary' | 'nested';
}

export function SectionGrid({
  sections,
  parentTrail,
  variant = 'nested'
}: SectionGridProps) {
  return (
    <div className={`section-grid section-grid--${variant}`}>
      {sections.map((section, index) => (
        <SectionCard
          key={section.slug}
          section={section}
          index={index}
          href={sectionHref([...parentTrail, section])}
          variant={variant}
        />
      ))}
    </div>
  );
}

function SectionCard({
  section,
  index,
  href,
  variant
}: {
  section: Section;
  index: number;
  href: string;
  variant: 'primary' | 'nested';
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
      className={`section-card section-card--${variant} reveal reveal-${Math.min(index + 2, 5)}`}
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
