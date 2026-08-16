import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// The <Database> generic is what makes every .from() return a typed row instead
// of `any`. Without it the Database type is dead weight and a renamed Postgres
// column surfaces as a runtime dead-letter rather than a build error.
export const supabase = createClient<Database>(supabaseUrl, supabaseKey);