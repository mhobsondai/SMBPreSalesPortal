import { Link } from 'react-router-dom';

import { sectionHref, type Section } from '../config/navigation';
import './Breadcrumbs.css';

/**
 * Breadcrumbs from a resolved trail, plus an optional `tail` for pages
 * that sit below a section but aren't sections themselves (tool pages).
 *
 * Necessary rather than decorative once nesting exists — at three levels
 * deep a reader needs to know where they are and how to step back one
 * level, not just jump to the root.
 */
export function Breadcrumbs({ trail, tail }: { trail: Section[]; tail?: string }) {
  return (
    <nav className="crumbs reveal reveal-1" aria-label="Breadcrumb">
      <Link to="/">Portal</Link>
      {trail.map((section, index) => {
        // With a `tail` present, every section is a link — the tail is the
        // current page.
        const isLast = !tail && index === trail.length - 1;
        const href = sectionHref(trail.slice(0, index + 1));
        return (
          <span key={section.slug} className="crumbs-item">
            <span className="crumbs-sep" aria-hidden="true">/</span>
            {isLast ? (
              <span aria-current="page">{section.name}</span>
            ) : (
              <Link to={href}>{section.name}</Link>
            )}
          </span>
        );
      })}
      {tail && (
        <span className="crumbs-item">
          <span className="crumbs-sep" aria-hidden="true">/</span>
          <span aria-current="page">{tail}</span>
        </span>
      )}
    </nav>
  );
}
