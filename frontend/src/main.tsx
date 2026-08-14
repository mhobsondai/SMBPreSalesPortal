import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AuthGate } from './components/AuthGate';
import { Landing } from './pages/Landing';
import { SectionPage } from './pages/SectionPage';
import { HealthCheck } from './pages/HealthCheck';
import { AssessmentScoringEngine } from './pages/tools/AssessmentScoringEngine';
import { FabricDataCalculator } from './pages/tools/FabricDataCalculator';
import { SapInstallAssessment } from './pages/tools/SapInstallAssessment';
import { SapQuoteGenerator } from './pages/tools/SapQuoteGenerator';
import { NotFound } from './pages/NotFound';
import './styles/tokens.css';
import './styles/base.css';

/*
 * The only lazily-loaded route. It carries d3 and a 170 kB example dataset,
 * which together are a third of the bundle — and nobody who came for a quote
 * needs either. Same reasoning as the dynamic `docx`/`exceljs` imports: heavy
 * things load when they are asked for.
 */
const DecisionConstellation = lazy(() =>
  import('./pages/tools/DecisionConstellation').then((m) => ({
    default: m.DecisionConstellation
  }))
);

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
              path="/tools/decision-constellation"
              element={
                <Suspense fallback={<div className="page">Loading the constellation…</div>}>
                  <DecisionConstellation />
                </Suspense>
              }
            />
            <Route
              path="/tools/fabric-data-calculator"
              element={<FabricDataCalculator />}
            />
            <Route
              path="/tools/sap-install-assessment"
              element={<SapInstallAssessment />}
            />
            <Route
              path="/tools/sap-quote-generator"
              element={<SapQuoteGenerator />}
            />
            <Route path="/health" element={<HealthCheck />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthGate>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
