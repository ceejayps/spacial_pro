import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import LoginPage from './pages/LoginPage';
import ModelViewerPage from './pages/ModelViewerPage';
import ScanLibraryPage from './pages/ScanLibraryPage';
import ScanPage from './pages/ScanPage';
import ScanPreviewPage from './pages/ScanPreviewPage';
import SignUpPage from './pages/SignUpPage';

function RouteBootScreen() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background-dark text-slate-300"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-primary" />
        <span className="text-xs font-semibold uppercase tracking-[0.3em]">Bootstrapping</span>
      </div>
    </div>
  );
}

function AuthGate({ children }: { children: ReactNode }) {
  const { ready, isAuthenticated } = useAuth();

  if (!ready) {
    return <RouteBootScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function GuestGate({ children }: { children: ReactNode }) {
  const { ready, isAuthenticated } = useAuth();

  if (!ready) {
    return <RouteBootScreen />;
  }

  if (isAuthenticated) {
    return <Navigate to="/library" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <div className="dark min-h-screen bg-background-light text-slate-900 dark:bg-background-dark dark:text-slate-100">
      <Routes>
        <Route path="/" element={<Navigate to="/library" replace />} />
        <Route
          path="/login"
          element={
            <GuestGate>
              <LoginPage />
            </GuestGate>
          }
        />
        <Route
          path="/signup"
          element={
            <GuestGate>
              <SignUpPage />
            </GuestGate>
          }
        />
        <Route
          path="/library"
          element={
            <AuthGate>
              <ScanLibraryPage />
            </AuthGate>
          }
        />
        <Route
          path="/scan"
          element={
            <AuthGate>
              <ScanPage />
            </AuthGate>
          }
        />
        <Route
          path="/preview/:scanId"
          element={
            <AuthGate>
              <ScanPreviewPage />
            </AuthGate>
          }
        />
        <Route
          path="/viewer/:scanId"
          element={
            <AuthGate>
              <ModelViewerPage />
            </AuthGate>
          }
        />
      </Routes>
    </div>
  );
}
