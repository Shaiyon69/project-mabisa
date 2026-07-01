import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import './App.css';
import { MabisaDataProvider } from './app/MabisaDataContext';
import { AppRoutes } from './app/routes/AppRoutes';
import { LoginPage } from './pages/auth/LoginPage';
import { supabase } from './lib/supabase';

type LoginState = {
  email: string;
  password: string;
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [demoAccess, setDemoAccess] = useState<'bhw' | 'admin' | null>(null);
  const [loginState, setLoginState] = useState<LoginState>({
    email: '',
    password: '',
  });
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const bhwId = useMemo(() => session?.user.id ?? null, [session]);
  const activeBhwId = bhwId ?? (demoAccess ? 'demo-ui-testing-bhw' : null);

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
    setDemoAccess(null);
    await supabase.auth.signOut();
  }

  // Temporary demo entry points for UI review only.
  // Keep the real Supabase login flow intact for production authentication.
  function handleDemoAccess(target: 'bhw' | 'admin') {
    window.history.pushState({}, '', target === 'admin' ? '/admin' : '/bhw');
    setDemoAccess(target);
  }

  if (!activeBhwId) {
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
        onDemoAccess={handleDemoAccess}
      />
    );
  }

  return (
    <BrowserRouter>
      <MabisaDataProvider bhwId={activeBhwId}>
        <AppRoutes logout={handleLogout} />
      </MabisaDataProvider>
    </BrowserRouter>
  );
}
