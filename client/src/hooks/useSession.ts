import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type Account } from '../lib/api';

/**
 * Session state.
 *
 * Kept in one place so the app has a single answer to "is somebody signed in", and
 * so a session that expires in the background is noticed once rather than on every
 * screen. The token itself lives in an httpOnly cookie; React only holds the
 * public account fields.
 */
export interface SessionState {
  account: Account | null;
  loading: boolean;
  signIn: (account: Account) => void;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
}

export function useSession(): SessionState {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    try {
      const { account: current } = await api.me();
      if (mounted.current) setAccount(current);
    } catch (error) {
      // A network failure here means "we cannot tell", not "signed out", so the
      // app stays usable and says the check failed rather than dumping the learner
      // back to the sign-in screen.
      if (error instanceof ApiError && error.status === 401 && mounted.current) setAccount(null);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
    };
  }, [reload]);

  const signIn = useCallback((next: Account) => setAccount(next), []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setAccount(null);
    }
  }, []);

  return { account, loading, signIn, signOut, reload };
}
