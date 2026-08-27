import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import './App.css';
import { MabisaDataProvider } from './app/MabisaDataContext';
import { AppRoutes } from './app/AppRoutes';
import { buildsBhw } from './app/surface';
import { LoginPage } from './pages/auth/LoginPage';
import { supabase } from './lib/supabase';
import { logDev } from './lib/utils';
import type { UserRole } from './types/database';

type LoginState = {
  email: string;
  password: string;
};

// The role decides which surface a session lands on, and a BHW opens this app in
// the field with no connection at all. Caching the last known role means an
// offline start reaches the routes immediately instead of waiting out a lookup
// that cannot succeed.
// The cache is keyed by auth id so a role can never leak across accounts sharing a
// device: a stale entry simply fails the id match and the session falls back to BHW.
const ROLE_CACHE_KEY = 'mabisa.user_role';

type CachedRole = {
  userId: string;
  role: UserRole;
};

function readCachedRole(): CachedRole | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(ROLE_CACHE_KEY) ?? 'null');
    const role: unknown = parsed?.role;

    if (typeof parsed?.userId !== 'string' || (role !== 'admin' && role !== 'bhw')) {
      return null;
    }

    return { userId: parsed.userId, role };
  } catch {
    return null;
  }
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loginState, setLoginState] = useState<LoginState>({
    email: '',
    password: '',
  });
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [cachedRole, setCachedRole] = useState<CachedRole | null>(readCachedRole);
  // Which account the profile lookup has actually answered for. Stored as the id
  // rather than a flag so a new session is unchecked by construction — a leftover
  // true would let the next account be judged on a lookup that ran for someone
  // else.
  const [checkedUserId, setCheckedUserId] = useState<string | null>(null);

  const bhwId = useMemo(() => session?.user.id ?? null, [session]);
  const role = cachedRole?.userId === bhwId ? cachedRole.role : null;
  // Whether the null above means "not an admin" or only "not known yet". The
  // admin surface needs the difference: it turns a null role away, and turning
  // someone away because a fetch has not returned is not the same decision as
  // turning them away because they are a BHW.
  const roleChecked = bhwId !== null && checkedUserId === bhwId;

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
      })
      .finally(() => {
        setAuthLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // auth.users carries no role, so it lives in a public.profiles row keyed by the
  // auth id — the same table every RLS helper reads, so the surface a session
  // lands on and the rows it can actually touch are decided by one column.
  // A failed lookup — offline, or no profile row yet — leaves the session on the
  // BHW surface, which is the safe direction to fail.
  useEffect(() => {
    if (!bhwId) {
      return;
    }

    let cancelled = false;

    supabase
      .from('profiles')
      .select('role, is_active')
      .eq('user_id', bhwId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) {
          return;
        }

        if (error) {
          // Offline, or no profile row yet. Either way the cached role stands —
          // and it is the only answer this device is going to get, so it counts
          // as checked.
          logDev('Role lookup failed', error.message);
          setCheckedUserId(bhwId);
          return;
        }

        // No cast needed: the Supabase client carries the <Database> generic, so
        // `role` arrives typed as UserRole rather than any.
        //
        // A deactivated profile resolves to no role, which lands on the BHW
        // surface. That is cosmetic, not the enforcement: every RLS helper
        // starts from current_profile_is_active(), so a disabled account reads
        // nothing whichever surface it is looking at.
        const nextRole = data?.is_active ? data.role : null;
        const next = nextRole ? { userId: bhwId, role: nextRole } : null;

        localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify(next));
        setCachedRole(next);
        setCheckedUserId(bhwId);
      });

    return () => {
      cancelled = true;
    };
  }, [bhwId]);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthMessage(null);
    setAuthLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: loginState.email,
      password: loginState.password,
    });

    setAuthLoading(false);

    if (error) {
      logDev('Supabase login failed', error.message);
      setAuthMessage(error.message);
      return;
    }

    setLoginState({
      email: '',
      password: '',
    });
  }

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  if (!bhwId) {
    return (
      <LoginPage
        email={loginState.email}
        password={loginState.password}
        authMessage={authMessage}
        authLoading={authLoading}
        onEmailChange={(email) =>
          setLoginState((current) => ({
            ...current,
            email,
          }))
        }
        onPasswordChange={(password) =>
          setLoginState((current) => ({
            ...current,
            password,
          }))
        }
        onSubmit={handleLogin}
      />
    );
  }

  const routes = <AppRoutes logout={handleLogout} role={role} roleChecked={roleChecked} />;

  return (
    <BrowserRouter>
      {/* The provider owns local SQLite and the background sync engine, which only
          the field app has any use for. An admin-only build carries no BHW route,
          so mounting it would open a database, register the jeep-sqlite web
          emulator and arm a sync timer on an LGU workstation that will never
          enqueue a row. No admin screen reads it. */}
      {buildsBhw ? <MabisaDataProvider bhwId={bhwId}>{routes}</MabisaDataProvider> : routes}
    </BrowserRouter>
  );
}
