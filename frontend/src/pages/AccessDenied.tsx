import { logoutUrl } from '../lib/auth';
import { useCurrentUser } from '../lib/useCurrentUser';
import './SignIn.css';

/**
 * Shown when sign-in succeeded but the account is not authorised.
 *
 * On the Free SKU this is a normal, expected state — the Microsoft
 * sign-in page accepts any account, so the portal must be able to turn
 * people away gracefully rather than white-screening.
 */
export function AccessDenied({ message }: { message?: string }) {
  const { data: user } = useCurrentUser();

  return (
    <main className="signin">
      <div className="signin-panel reveal reveal-1">
        <div className="signin-brand">
          <span className="signin-mark" aria-hidden="true" />
          <span className="signin-brand-text">Codestone</span>
        </div>

        <div className="eyebrow">Access denied</div>
        <h1 className="signin-title">
          You're signed in, but <em>not authorised</em>.
        </h1>
        <p className="signin-lede">
          {message ??
            'This portal is restricted to Codestone staff. Your Microsoft account is valid, but it is not on the access list.'}
        </p>

        {user && (
          <p className="signin-account">
            Signed in as <strong>{user.upn}</strong>
          </p>
        )}

        <a href={logoutUrl('/')} className="btn btn-secondary signin-btn">
          Sign out and try another account
        </a>

        <p className="signin-foot">
          If you believe you should have access, contact the portal owner.
          Do not share this URL outside Codestone.
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
