import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import IntersectObserver from '@/components/common/IntersectObserver';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/contexts/AuthContext';
import { RouteGuard } from '@/components/common/RouteGuard';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';

import { routes } from './routes';

const LoginPage = lazy(() => import('./pages/LoginPage'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="animate-spin h-7 w-7 border-2 border-primary border-t-transparent rounded-full" />
        <p className="text-sm">Loading…</p>
      </div>
    </div>
  );
}

const App = () => {
  return (
    <ErrorBoundary>
      <Router>
        <AuthProvider>
          <IntersectObserver />
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* Public route — outside RouteGuard */}
              <Route path="/login" element={<LoginPage />} />

              {/* All other routes are protected */}
              {routes
                .filter((r) => r.path !== '/login' && r.element !== null)
                .map((route, index) => (
                  <Route
                    key={index}
                    path={route.path}
                    element={<RouteGuard>{route.element}</RouteGuard>}
                  />
                ))}

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
          <Toaster />
        </AuthProvider>
      </Router>
    </ErrorBoundary>
  );
};

export default App;
