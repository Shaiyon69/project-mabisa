import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import './App.css';
import { MabisaDataProvider } from './app/MabisaDataContext';
import { AppRoutes } from './app/AppRoutes';
import { LoginPage } from './pages/auth/LoginPage';
import { supabase } from './lib/supabase';
import { describeAuthError } from './lib/authErrors';
import { countPendingQueueEntries } from './services/localDatabase';
import { buildsBhw } from './app/surface';
import { logDev } from './lib/utils';
import { isDeskRole, type UserRole } from './types/database';

type LoginState = {
  email: string;
  password: string;
};

// Caches the last known role so an offline BHW reaches the routes immediately
// instead of waiting on a lookup that can't succeed. Keyed by auth id so a role
// can never leak across accounts sharing a device.
const ROLE_CACHE_KEY = 'mabisa.user_role';

type CachedRole = {
  userId: string;
  role: UserRole;
};

/** Every value public.app_role has — kept as a list so a new enum value can't be silently rejected by a stale check. */
const ROLES: UserRole[] = ['admin', 'barangay_admin', 'bhw'];

function readCachedRole(): CachedRole | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(ROLE_CACHE_KEY) ?? 'null');
    const role: unknown = parsed?.role;

    if (typeof parsed?.userId !== 'string' || !ROLES.includes(role as UserRole)) {
      return null;
    }

    return { userId: parsed.userId, role: role as UserRole };
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
  // Which account the profile lookup last answered for — an id, not a flag, so a
  // new session starts unchecked rather than inheriting the previous account's answer.
  const [checkedUserId, setCheckedUserId] = useState<string | null>(null);
  const [pendingRecordCount, setPendingRecordCount] = useState<number | null>(null);

  const bhwId = useMemo(() => session?.user.id ?? null, [session]);
  const role = cachedRole?.userId === bhwId ? cachedRole.role : null;
  // Whether null above means "not an admin" or "not known yet" — the admin
  // surface must not turn someone away just because the fetch hasn't returned.
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

  // Role lives in public.profiles, keyed by auth id. A failed lookup (offline, or
  // no profile row yet) leaves the session on the BHW surface — the safe direction to fail.
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
          // Offline, or no profile row yet — the cached role stands and counts as checked.
          logDev('Role lookup failed', error.message);
          setCheckedUserId(bhwId);
          return;
        }

        // A deactivated profile resolves to no role (cosmetic only — RLS itself
        // blocks a disabled account via current_profile_is_active()).
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

  // How many unsent records sit on this device while signed out (an expired
  // refresh token drops a BHW here mid-fieldwork). Field build only — the portal keeps no local records.
  useEffect(() => {
    if (bhwId || !buildsBhw) {
      return;
    }

    let cancelled = false;

    countPendingQueueEntries()
      .then((count) => !cancelled && setPendingRecordCount(count))
      .catch((error: unknown) => {
        // No database yet on a device that's never saved anything — not worth surfacing here.
        logDev('Pending record count unavailable', error instanceof Error ? error.message : String(error));
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
      // Raw text goes to the log; the screen gets a sentence naming what to try next.
      logDev('Supabase login failed', error.message);
      setAuthMessage(describeAuthError(error.message));
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
        pendingRecordCount={pendingRecordCount}
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

  // The offline engine (local SQLite, sync queue) is BHW-only; the admin portal
  // reads Supabase directly and must never pull residents into browser storage.
  // Role starts null until checked, so this defaults on until a desk role is
  // confirmed — the same fail-safe direction as the rest of the app.
  const runsOfflineEngine = buildsBhw && !isDeskRole(role);

  const routes = <AppRoutes logout={handleLogout} role={role} roleChecked={roleChecked} />;

  return (
    <BrowserRouter>
      {runsOfflineEngine ? <MabisaDataProvider bhwId={bhwId}>{routes}</MabisaDataProvider> : routes}
    </BrowserRouter>
  );
}
