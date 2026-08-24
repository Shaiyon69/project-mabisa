import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';
import { secureStorage } from './secureStorage';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// The <Database> generic makes every .from() return a typed row instead of `any`
// — a renamed Postgres column then surfaces as a build error, not a runtime dead-letter.
//
// The session lives in `secureStorage` (Android Keystore on device, localStorage
// in a browser) — a refresh token is a long-lived credential and shouldn't sit in
// plain web storage on a phone that lives in a bag.
//
// `mabisa.user_role` in App.tsx deliberately stays in plain localStorage instead:
// it's read synchronously at mount for an offline cold start, holds a role rather
// than a credential, and is keyed by auth id so it can't be replayed for another account.
export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    storage: secureStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});
