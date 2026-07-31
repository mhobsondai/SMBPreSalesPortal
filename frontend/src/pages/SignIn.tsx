import { loginUrl } from '../lib/auth';
import './SignIn.css';

/**
 * Sign-in screen.
 *
 * Rendered by AuthGate whenever /.auth/me returns no principal. The button
 * is a plain anchor to the SWA login endpoint — the redirect, the Entra
 * round trip, and the session cookie are all handled by the platform.
 */
export function SignIn() {
  return (
    <main className="signin">
      <div className="signin-panel reveal reveal-1">
        <div className="signin-brand">
          <span className="signin-mark" aria-hidden="true" />
          <span className="signin-brand-text">Codestone</span>
        </div>

        <div className="eyebrow">SMB Pre-Sales Portal</div>
        <h1 className="signin-title">
          Sign in to <em>continue</em>
        </h1>
        <p className="signin-lede">
          This portal is restricted to authorised Codestone pre-sales staff.
          Sign in with your Microsoft work account to continue.
        </p>

        <a href={loginUrl('/')} className="btn signin-btn">
          <svg viewBox="0 0 21 21" aria-hidden="true" className="ms-logo">
            <rect x="1" y="1" width="9" height="9" fill="#f25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
          Sign in with Microsoft
        </a>

        <p className="signin-foot">
          Access is managed in Entra ID. If you cannot sign in, contact the
          portal owner to have your account granted access.
        </p>
      </div>

      <aside className="signin-aside" aria-hidden="true">
        <div className="signin-aside-inner">
          <div className="signin-aside-eyebrow">Practice areas</div>
          <ul>
            <li>Infrastructure &amp; 365</li>
            <li>ERP</li>
            <li>Data &amp; AI</li>
          </ul>
        </div>
      </aside>
    </main>
  );
}
