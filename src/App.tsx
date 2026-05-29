import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import Dashboard from './components/Dashboard';

type Todo = {
  id: number;
  name: string;
};

export default function App() {
  const [session, setSession] = useState<any>(null);

  const [email, setEmail] =
    useState<string>('');

  const [password, setPassword] =
    useState<string>('');

  const [todos, setTodos] = useState<Todo[]>(
    []
  );

  // CHECK SESSION
  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        setSession(session);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // FETCH TODOS AFTER LOGIN
  useEffect(() => {
    if (session) {
      getTodos();
    }
  }, [session]);

  // GET TODOS
  async function getTodos() {
    const { data, error } = await supabase
      .from('todos')
      .select('*');

    if (error) {
      console.log(error);
    } else {
      setTodos(data || []);
    }
  }

  // LOGIN
  async function handleLogin(
    e: React.FormEvent
  ) {
    e.preventDefault();

    const { error } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (error) {
      alert(error.message);
    }
  }

  // REGISTER
  async function handleRegister() {
    const { error } =
      await supabase.auth.signUp({
        email,
        password,
      });

    if (error) {
      alert(error.message);
    } else {
      alert('Registration successful!');
    }
  }

  // LOGOUT
  async function handleLogout() {
    await supabase.auth.signOut();
  }

  // LOGIN PAGE
  if (!session) {
    return (
      <div style={{ padding: '20px' }}>
        <h1>Login</h1>

        <form onSubmit={handleLogin}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
            }
          />

          <br />
          <br />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value)
            }
          />

          <br />
          <br />

          <button type="submit">
            Login
          </button>

          <button
            type="button"
            onClick={handleRegister}
            style={{ marginLeft: '10px' }}
          >
            Register
          </button>
        </form>
      </div>
    );
  }

  // DASHBOARD
  return (
    <Dashboard
      todos={todos}
      logout={handleLogout}
    />
  );
}