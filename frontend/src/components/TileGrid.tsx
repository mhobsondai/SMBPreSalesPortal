import { Link } from 'react-router-dom';

import type { Tile, TileStatus } from '../config/navigation';
import './TileGrid.css';

const STATUS_LABEL: Record<TileStatus, string> = {
  live: 'Live',
  development: 'In development',
  planned: 'Planned'
};

interface TileGridProps {
  tiles: Tile[];
}

export function TileGrid({ tiles }: TileGridProps) {
  if (tiles.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon" aria-hidden="true">∅</div>
        <h3>Nothing here yet</h3>
        <p>Tools for this practice area haven't been added.</p>
      </div>
    );
  }

  return (
    <div className="tile-grid">
      {tiles.map((tile, index) => (
        <TileCard key={tile.id} tile={tile} index={index} />
      ))}
    </div>
  );
}

function TileCard({ tile, index }: { tile: Tile; index: number }) {
  const revealClass = `reveal reveal-${Math.min(index + 2, 5)}`;
  const isLive = tile.status === 'live' && (tile.to || tile.href);

  const body = (
    <>
      <div className={`tile-status tile-status--${tile.status}`}>
        <span className="dot" aria-hidden="true" />
        {STATUS_LABEL[tile.status]}
      </div>
      <h3 className="tile-title">{tile.title}</h3>
      <p className="tile-desc">{tile.description}</p>
      {isLive && (
        <span className="tile-cta">
          Open
          <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M1 7H13M13 7L8 2M13 7L8 12"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )}
    </>
  );

  if (tile.status === 'live' && tile.to) {
    return (
      <Link to={tile.to} className={`tile tile--live ${revealClass}`}>
        {body}
      </Link>
    );
  }

  if (tile.status === 'live' && tile.href) {
    return (
      <a
        href={tile.href}
        className={`tile tile--live ${revealClass}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {body}
      </a>
    );
  }

  return (
    <div className={`tile tile--inert ${revealClass}`} aria-disabled="true">
      {body}
    </div>
  );
}
