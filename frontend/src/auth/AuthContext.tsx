import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  authChangedEventName,
  clearAuthSession,
  fetchCurrentUser,
  getAuthToken,
  getStoredAuthUser,
  hydrateAuthSession,
  isAuthError,
  loginUser,
  registerUser,
  type AuthUser,
} from '../services/authService';

type AuthContextValue = {
  ready: boolean;
  isAuthenticated: boolean;
  user: AuthUser | null;
  signIn: (input: { email: string; password: string }) => Promise<AuthUser>;
  signUp: (input: { fullName: string; email: string; password: string }) => Promise<AuthUser>;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(() => getStoredAuthUser());

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      await hydrateAuthSession();
      const token = getAuthToken();

      if (!token) {
        if (active) {
          setReady(true);
        }
        return;
      }

      try {
        const me = await fetchCurrentUser(token);

        if (!active) {
          return;
        }

        if (!me) {
          clearAuthSession();
          setUser(null);
        } else {
          setUser(me);
        }
      } catch (error) {
        if (!active) {
          return;
        }

        if (isAuthError(error)) {
          clearAuthSession();
          setUser(null);
        } else {
          setUser(getStoredAuthUser());
        }
      } finally {
        if (active) {
          setReady(true);
        }
      }
    };

    void bootstrap();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleAuthChanged = () => {
      setUser(getStoredAuthUser());
    };

    const eventName = authChangedEventName();
    window.addEventListener(eventName, handleAuthChanged);

    return () => {
      window.removeEventListener(eventName, handleAuthChanged);
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      isAuthenticated: Boolean(user),
      user,
      signIn: async (input) => {
        const result = await loginUser(input);
        setUser(result.user);
        return result.user;
      },
      signUp: async (input) => {
        const result = await registerUser(input);
        setUser(result.user);
        return result.user;
      },
      signOut: () => {
        clearAuthSession();
        setUser(null);
      },
    }),
    [ready, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.');
  }

  return context;
}
