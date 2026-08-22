import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';
import { secureStorage } from './secureStorage';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// The <Database> generic is what makes every .from() return a typed row instead
// of `any`. Without it the Database type is dead weight and a renamed Postgres
// column surfaces as a runtime dead-letter rather than a build error.
//
// The session lives in `secureStorage`, which is the Android Keystore on a device
// and `localStorage` in a browser. A refresh token is a long-lived credential to
// a barangay's health records and it used to sit in web storage on a phone that
// spends its life in a bag. supabase-js accepts a promise-returning adapter, so
// the client does not need to know which of the two it got.
//
// `mabisa.user_role` in App.tsx deliberately stays in localStorage: it is read
// synchronously at mount so an offline cold start never waits on a lookup that
// cannot finish, it holds a role rather than a credential, and it is keyed by
// auth id so it cannot be replayed for a different account.
export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    storage: secureStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});
