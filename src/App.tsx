import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import './App.css';
import Dashboard from './components/Dashboard';
import { supabase } from '../utils/supabase';

type LoginState = {
  email: string;
  password: string;
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loginState, setLoginState] = useState<LoginState>({
    email: '',
    password: '',
  });
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const bhwId = useMemo(() => session?.user.id ?? null, [session]);

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
      <main className="mobile-shell auth-shell">
        <section className="login-panel">
          <div>
            <p className="eyebrow">Project MABISA</p>
            <h1>BHW Mobile Login</h1>
            <p className="muted">Sign in once while online, then continue encoding barangay records on the device.</p>
          </div>

          <form className="stack" onSubmit={handleLogin}>
            <label>
              <span>Email</span>
              <input
                autoComplete="email"
                inputMode="email"
                type="email"
                value={loginState.email}
                onChange={(event) =>
                  setLoginState((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                required
              />
            </label>

            <label>
              <span>Password</span>
              <input
                autoComplete="current-password"
                type="password"
                value={loginState.password}
                onChange={(event) =>
                  setLoginState((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                required
              />
            </label>

            {authMessage ? <p className="alert">{authMessage}</p> : null}

            <button className="primary-button" type="submit" disabled={authLoading}>
              {authLoading ? 'Checking Access' : 'Login'}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return <Dashboard bhwId={bhwId} logout={handleLogout} />;
}
