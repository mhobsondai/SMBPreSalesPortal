import { TopBar } from '../components/TopBar';
import { SectionGrid } from '../components/SectionGrid';
import { useCurrentUser } from '../lib/useCurrentUser';
import { SECTIONS } from '../config/navigation';
import { APP_VERSION } from '../config/app';
import './Landing.css';

export function Landing() {
  const { data: user, isLoading } = useCurrentUser();
  const firstName = user?.displayName?.split(' ')[0] ?? (isLoading ? '…' : 'there');

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="landing-header reveal reveal-1">
          <div className="eyebrow">SMB Pre-Sales Portal · {APP_VERSION}</div>
          <h1 className="display">
            Welcome, <em>{firstName}</em>.
          </h1>
          <p className="lede">
            Pre-sales tooling for the SMB practice. Choose an area to see the
            tools available to you.
          </p>
        </section>

        <div className="section-heading reveal reveal-2">
          <h2>Practice areas</h2>
          <span className="section-meta">{SECTIONS.length} areas</span>
        </div>

        <SectionGrid sections={SECTIONS} parentTrail={[]} />
      </main>

      <footer className="page-footer">
        SMB Pre-Sales Portal · {APP_VERSION} · Codestone internal use only
      </footer>
    </>
  );
}
