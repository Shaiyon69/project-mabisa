import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';
import { secureStorage } from './secureStorage';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// The <Database> generic makes every .from() return a typed row, so a renamed
// Postgres column is a build error rather than a runtime dead-letter.
//
// The session lives in `secureStorage` (Android Keystore on device, localStorage
// in a browser), since a refresh token is a long-lived credential.
//
// `mabisa.user_role` in App.tsx stays in plain localStorage: it is read
// synchronously at mount for an offline cold start, holds a role rather than a
// credential, and is keyed by auth id.
export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    storage: secureStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});

/** Rows per request. Supabase's own default cap, so asking for more gets silently trimmed anyway. */
export const PULL_PAGE_SIZE = 1000;

/**
 * Reads one table to the end, a page at a time.
 *
 * A single `select('*')` stops at the server's row cap and says nothing about it:
 * on the phone the pull watermark then advances past rows it never saw, and on
 * the portal a count or an export reads as complete while missing them. Ordering
 * by a column plus the primary key keeps the pages a stable sequence.
 *
 * Lives here rather than in `syncService`, which the portal must not import.
 */
export async function readAllPages<TRow>(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: TRow[] | null; error: { message: string } | null }>,
): Promise<TRow[]> {
  const rows: TRow[] = [];

  for (;;) {
    const { data, error } = await page(rows.length, rows.length + PULL_PAGE_SIZE - 1);

    if (error) {
      throw new Error(`${label} Pull Error: ${error.message}`);
    }

    rows.push(...(data ?? []));

    // A short page is the last page — a full one might not be, so ask again.
    if ((data?.length ?? 0) < PULL_PAGE_SIZE) {
      return rows;
    }
  }
}
