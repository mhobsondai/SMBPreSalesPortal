import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AuthGate } from './components/AuthGate';
import { Landing } from './pages/Landing';
import { SectionPage } from './pages/SectionPage';
import { HealthCheck } from './pages/HealthCheck';
import { AssessmentScoringEngine } from './pages/tools/AssessmentScoringEngine';
import { FabricDataCalculator } from './pages/tools/FabricDataCalculator';
import { NotFound } from './pages/NotFound';
import './styles/tokens.css';
import './styles/base.css';

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
            principal resolves and /api/me confirms authorisation.
            Server-side enforcement lives in staticwebapp.config.json and
            api/shared/auth.py. */}
        <AuthGate>
          <Routes>
            <Route path="/" element={<Landing />} />
            {/* Splat route — the navigation tree is walked at render
                time, so nesting depth never requires a router change.
                See config/navigation.ts. */}
            <Route path="/area/*" element={<SectionPage />} />
            {/* Tools live at /tools/<slug>. Each is referenced from a
                Tile in config/navigation.ts. */}
            <Route
              path="/tools/assessment-scoring"
              element={<AssessmentScoringEngine />}
            />
            <Route
              path="/tools/fabric-data-calculator"
              element={<FabricDataCalculator />}
            />
            <Route path="/health" element={<HealthCheck />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthGate>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
