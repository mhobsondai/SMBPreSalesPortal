import { Link } from 'react-router-dom';

import { logoutUrl } from '../lib/auth';
import { useCurrentUser } from '../lib/useCurrentUser';
import { initials } from '../lib/displayName';
import './TopBar.css';

export interface TopBarLink {
  label: string;
  to?: string;
  href?: string;
}

interface TopBarProps {
  links?: TopBarLink[];
}

export function TopBar({ links = [] }: TopBarProps) {
  const { data: user } = useCurrentUser();

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-divider" />
          <span className="brand-app">SMB Pre-Sales Portal</span>
        </Link>

        <div className="topbar-right">
          {links.map((link) =>
            link.href ? (
              <a key={link.href} href={link.href} className="topbar-link">
                {link.label}
              </a>
            ) : (
              <Link key={link.to} to={link.to as string} className="topbar-link">
                {link.label}
              </Link>
            )
          )}

          {user && (
            <a href={logoutUrl()} className="user-chip" title={`Sign out of ${user.displayName}`}>
              <span className="user-avatar">{initials(user.displayName)}</span>
              <span className="user-name">{user.displayName}</span>
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
