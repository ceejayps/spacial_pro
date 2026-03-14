import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';

type AuthContextValue = {
  ready: boolean;
  isAuthenticated: boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const AUTH_BOOTSTRAP_KEY = 'lidar-pro.auth.stub';

function readBootstrapAuthState() {
  try {
    return window.sessionStorage.getItem(AUTH_BOOTSTRAP_KEY) === 'true';
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    let active = true;

    // PR-02 keeps bootstrap lightweight until the real auth service arrives.
    const bootstrap = async () => {
      const nextAuthenticated = readBootstrapAuthState();

      if (!active) {
        return;
      }

      setIsAuthenticated(nextAuthenticated);
      setReady(true);
    };

    void Promise.resolve().then(bootstrap);

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const refresh = () => {
      setIsAuthenticated(readBootstrapAuthState());
    };

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  return <AuthContext.Provider value={{ ready, isAuthenticated }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.');
  }

  return context;
}
