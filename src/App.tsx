import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import './App.css';
import { MabisaDataProvider } from './app/MabisaDataContext';
import { AppRoutes } from './app/routes/AppRoutes';
import { LoginPage } from './pages/auth/LoginPage';
import { supabase } from './lib/supabase';
import { logDev } from './lib/utils';

type LoginState = {
  email: string;
  password: string;
};

export function App() {
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

  return (
    <BrowserRouter>
      <MabisaDataProvider bhwId={bhwId}>
        <AppRoutes logout={handleLogout} />
      </MabisaDataProvider>
    </BrowserRouter>
  );
}
