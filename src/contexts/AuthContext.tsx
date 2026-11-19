import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { apiFetch } from '../lib/api.ts';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { useStudioStore, type StudioUser } from '../store/useStudioStore.ts';

interface AuthContextValue {
  firebaseUser: User | null;
  loading: boolean;
  signingIn: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const setUser = useStudioStore((s) => s.setUser);
  const setLocale = useStudioStore((s) => s.setLocale);
  const setTheme = useStudioStore((s) => s.setTheme);

  const syncUserWithBackend = useCallback(
    async (user: User) => {
      const token = await user.getIdToken();
      const data = await apiFetch<{ user: StudioUser }>('/api/auth/me', {}, token);
      if (!data?.user) {
        throw new Error('پاسخ حساب کاربری از سرور نامعتبر است.');
      }
      setUser(data.user);
      if (data.user.preferredLocale === 'en' || data.user.preferredLocale === 'fa') {
        setLocale(data.user.preferredLocale);
      }
      if (data.user.preferredTheme === 'light' || data.user.preferredTheme === 'dark') {
        setTheme(data.user.preferredTheme);
      }
    },
    [setUser, setLocale, setTheme]
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          await syncUserWithBackend(user);
          setAuthError(null);
        } catch (err) {
          console.error('Failed to sync authenticated user:', err);
          setAuthError(
            err instanceof Error ? err.message : 'خطا در همگام‌سازی حساب کاربری'
          );
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [syncUserWithBackend, setUser]);

  const signInWithGoogle = useCallback(async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      console.error('Google Sign-In failed:', err);
      setAuthError(
        err instanceof Error ? err.message : 'ورود با حساب گوگل ناموفق بود.'
      );
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
    setUser(null);
  }, [setUser]);

  const getToken = useCallback(async () => {
    if (!auth.currentUser) return null;
    return await auth.currentUser.getIdToken();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        loading,
        signingIn,
        authError,
        signInWithGoogle,
        signOut,
        getToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
