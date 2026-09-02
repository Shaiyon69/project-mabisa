import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import './App.css';
import { AppRoutes, SurfaceNotice } from './app/AppRoutes';
import { LoginPage } from './pages/auth/LoginPage';
import { supabase } from './lib/supabase';
import { describeAuthError } from './lib/authErrors';
import type { Handover } from './services/deviceHandover';
import { clearPin } from './lib/devicePin';
import { buildsBhw } from './app/surface';
import { logDev } from './lib/utils';
import { isDeskRole, isUserRole, type UserRole } from './types/database';

type LoginState = {
  email: string;
  password: string;
};

// Caches the last known role so an offline BHW reaches the routes without waiting
// on a lookup that cannot succeed. Keyed by auth id, so nothing leaks between
// accounts sharing a device.
const ROLE_CACHE_KEY = 'mabisa.user_role';

// The provider reaches localDatabase and syncService, and through them Capacitor
// SQLite. Lazy, so the admin bundle — which never renders it — drops the whole
// subtree. On the phone the chunk is on the filesystem, so the fallback is a frame.
const MabisaDataProvider = lazy(() =>
  import('./app/MabisaDataContext').then((module) => ({ default: module.MabisaDataProvider })),
);

// The name rides in the same cache entry as the role: same row, same screens, and
// a device cannot end up showing one without the other.
type CachedRole = {
  userId: string;
  role: UserRole;
  fullName: string | null;
};

function readCachedRole(): CachedRole | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(ROLE_CACHE_KEY) ?? 'null');
    const role: unknown = parsed?.role;

    if (typeof parsed?.userId !== 'string' || !isUserRole(role)) {
      return null;
    }

    // An entry written before the name was cached is still valid; the next
    // successful lookup fills it in.
    const fullName: unknown = parsed?.fullName;

    return { userId: parsed.userId, role, fullName: typeof fullName === 'string' ? fullName : null };
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
  // Which account the profile lookup last answered for. An id, not a flag, so a
  // new session starts unchecked.
  const [checkedUserId, setCheckedUserId] = useState<string | null>(null);
  const [pendingRecordCount, setPendingRecordCount] = useState<number | null>(null);
  // Whether this account may use this phone's local records, and which account the
  // answer is about. An id rather than a flag, like `checkedUserId` above.
  const [handover, setHandover] = useState<{ userId: string; result: Handover } | null>(null);

  const bhwId = useMemo(() => session?.user.id ?? null, [session]);
  const role = cachedRole?.userId === bhwId ? cachedRole.role : null;
  // Gated on the same id match as the role, so a shared phone cannot show one
  // worker the other's name while the lookup is in flight.
  const fullName = cachedRole?.userId === bhwId ? cachedRole.fullName : null;
  // Whether null above means "not an admin" or "not known yet".
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

  // Role lives in public.profiles, keyed by auth id. A failed lookup leaves the
  // session on the BHW surface, the safe direction to fail.
  useEffect(() => {
    if (!bhwId) {
      return;
    }

    let cancelled = false;

    supabase
      .from('profiles')
      .select('role, is_active, full_name')
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

        // A deactivated profile resolves to no role. Cosmetic only: RLS blocks a
        // disabled account through current_profile_is_active().
        const nextRole = data?.is_active ? data.role : null;
        const next = nextRole ? { userId: bhwId, role: nextRole, fullName: data?.full_name ?? null } : null;

        localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify(next));
        setCachedRole(next);
        setCheckedUserId(bhwId);
      });

    return () => {
      cancelled = true;
    };
  }, [bhwId]);

  // How many unsent records sit on this device while signed out. Field build only,
  // since the portal keeps no local records.
  useEffect(() => {
    if (bhwId || !buildsBhw) {
      return;
    }

    let cancelled = false;

    // Imported here rather than at module scope: this is the portal's only
    // reachable path into localDatabase, and a dynamic import behind the
    // `buildsBhw` check above keeps that subtree out of its bundle.
    import('./services/localDatabase')
      .then(({ countRows }) => countRows('sync_queue'))
      .then((count) => !cancelled && setPendingRecordCount(count))
      .catch((error: unknown) => {
        // No database yet on a device that's never saved anything — not worth surfacing here.
        logDev('Pending record count unavailable', error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [bhwId]);

  // A phone that changes hands carries the previous worker's purok and unsent
  // queue, so this settles before anything reads or pushes. Field build only.
  useEffect(() => {
    if (!bhwId || !buildsBhw) {
      return;
    }

    let cancelled = false;

    // Dynamic for the same reason as the count above: deviceHandover imports both
    // localDatabase and syncService.
    import('./services/deviceHandover')
      .then(({ claimDeviceFor }) => claimDeviceFor(bhwId))
      .then((result) => !cancelled && setHandover({ userId: bhwId, result }))
      .catch((error: unknown) => {
        // The local database could not be read, so whose records these are is
        // unknown. Holding is the safe direction.
        logDev('Device handover check failed', error instanceof Error ? error.message : String(error));

        return !cancelled && setHandover({ userId: bhwId, result: { claimed: false, unsent: 0 } });
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
    // Clears the device PIN with the session, so the next person sets their own and
    // signing in again is the way back for someone who forgot theirs.
    if (bhwId) {
      await clearPin(bhwId);
    }

    await supabase.auth.signOut();

    // The sign-in screen renders outside the router, so nothing else resets the
    // address bar for the next person to sign in.
    window.history.replaceState(null, '', '/');
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

  // The portal never asks — it holds no local records, so there is nothing to hand over.
  const deviceReady = buildsBhw ? (handover?.userId === bhwId ? handover.result : null) : { claimed: true as const };

  if (!deviceReady) {
    return <SurfaceNotice title="Checking this device" body="One moment." />;
  }

  if (!deviceReady.claimed) {
    return (
      <SurfaceNotice
        title="This phone is still holding another health worker's records"
        body={
          deviceReady.unsent > 0
            ? `${deviceReady.unsent} record(s) saved here have not reached the health office yet, and only the worker who recorded them can send them. Ask her to sign in on this phone and sync, then sign in again.`
            : 'The records on this phone could not be read, so there is no way to tell whose they are. Sign in again once there is a connection, or ask the health office.'
        }
        logout={handleLogout}
      />
    );
  }

  // The offline engine (local SQLite, sync queue) is BHW-only: the portal reads
  // Supabase directly and must never pull residents into browser storage. Role
  // starts null, so this defaults on until a desk role is confirmed.
  const runsOfflineEngine = buildsBhw && !isDeskRole(role);

  const routes = <AppRoutes logout={handleLogout} role={role} roleChecked={roleChecked} fullName={fullName} />;

  return (
    <BrowserRouter>
      {runsOfflineEngine ? (
        <Suspense fallback={<SurfaceNotice title="Starting up" body="One moment." />}>
          <MabisaDataProvider bhwId={bhwId}>{routes}</MabisaDataProvider>
        </Suspense>
      ) : (
        routes
      )}
    </BrowserRouter>
  );
}
