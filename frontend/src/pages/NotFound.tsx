import { Link } from 'react-router-dom';

import { TopBar } from '../components/TopBar';

export function NotFound() {
  return (
    <>
      <TopBar />
      <main className="page">
        <div className="eyebrow">404</div>
        <h1 className="display">Page not found</h1>
        <p className="lede">
          That page doesn't exist. <Link to="/">Return to the portal home</Link>.
        </p>
      </main>
    </>
  );
}
