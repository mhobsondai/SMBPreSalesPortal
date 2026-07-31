import { Link } from 'react-router-dom';

import type { Section, Tile, TileStatus } from '../config/navigation';
import './ToolList.css';

const STATUS_LABEL: Record<TileStatus, string> = {
  live: 'Live',
  development: 'In dev',
  planned: 'Planned'
};

/**
 * A section rendered as a headed group of compact list rows.
 *
 * This replaces the earlier card-grid-per-page approach. With dozens of
 * tools expected, scanning a dense list beats clicking through pages of
 * large cards — the whole practice area fits on one screen.
 */
export function ToolList({ section }: { section: Section }) {
  const tiles = section.tiles ?? [];

  return (
    <section className="tool-group">
      <header className="tool-group-head">
        <h3>{section.name}</h3>
        <span className="tool-group-count">
          {String(tiles.length).padStart(2, '0')}
        </span>
      </header>
      <p className="tool-group-summary">{section.summary}</p>

      {tiles.length === 0 ? (
        <p className="tool-group-empty">No tools yet.</p>
      ) : (
        <ul className="tool-rows">
          {tiles.map((tile) => (
            <li key={tile.id}>
              <ToolRow tile={tile} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ToolRow({ tile }: { tile: Tile }) {
  const isLive = tile.status === 'live' && (tile.to || tile.href);
  const isExternal = Boolean(tile.href);

  const body = (
    <>
      <span className="tool-row-main">
        <span className="tool-row-title">
          {tile.title}
          {isExternal && (
            <svg
              className="tool-row-ext"
              viewBox="0 0 12 12"
              fill="none"
              aria-label="Opens in a new tab"
              role="img"
            >
              <path
                d="M4.5 2H10V7.5M10 2L5 7M8 10H2V4"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
        <span className="tool-row-desc">{tile.description}</span>
      </span>
      <span className={`tool-row-status tool-row-status--${tile.status}`}>
        {STATUS_LABEL[tile.status]}
      </span>
      <span className="tool-row-arrow" aria-hidden="true">
        →
      </span>
    </>
  );

  if (isLive && tile.to) {
    return (
      <Link to={tile.to} className="tool-row tool-row--live">
        {body}
      </Link>
    );
  }

  if (isLive && tile.href) {
    return (
      <a
        href={tile.href}
        className="tool-row tool-row--live"
        target="_blank"
        rel="noopener noreferrer"
      >
        {body}
      </a>
    );
  }

  return (
    <div className="tool-row tool-row--inert" aria-disabled="true">
      {body}
    </div>
  );
}
