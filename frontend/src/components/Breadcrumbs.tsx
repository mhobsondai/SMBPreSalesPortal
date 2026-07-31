import { Link } from 'react-router-dom';

import { sectionHref, type Section } from '../config/navigation';
import './Breadcrumbs.css';

/**
 * Breadcrumbs from a resolved trail.
 *
 * Necessary rather than decorative once nesting exists — at three levels
 * deep a reader needs to know where they are and how to step back one
 * level, not just jump to the root.
 */
export function Breadcrumbs({ trail }: { trail: Section[] }) {
  return (
    <nav className="crumbs reveal reveal-1" aria-label="Breadcrumb">
      <Link to="/">Portal</Link>
      {trail.map((section, index) => {
        const isLast = index === trail.length - 1;
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
    </nav>
  );
}
