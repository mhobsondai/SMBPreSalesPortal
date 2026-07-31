import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AuthGate } from './components/AuthGate';
import { Landing } from './pages/Landing';
import { PracticeAreaPage } from './pages/PracticeAreaPage';
import { HealthCheck } from './pages/HealthCheck';
import { NotFound } from './pages/NotFound';
import './styles/tokens.css';
import './styles/base.css';

// One QueryClient for the whole app — handles fetching, caching and
// retry policy for all server state.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false
    }
  }
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found — check index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* AuthGate wraps every route: nothing renders until the SWA
            principal resolves. Server-side enforcement lives in
            staticwebapp.config.json and the API itself. */}
        <AuthGate>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/area/:slug" element={<PracticeAreaPage />} />
            <Route path="/health" element={<HealthCheck />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthGate>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
