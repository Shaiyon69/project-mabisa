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

/** Rows per request. Supabase's own default cap, so asking for more gets silently trimmed anyway. */
export const PULL_PAGE_SIZE = 1000;

/**
 * Reads one table to the end, a page at a time.
 *
 * A single `select('*')` stops at the server's row cap and says nothing about
 * it, and an unordered truncated read is the dangerous half: the phone's pull
 * watermark then advances to the newest row that happened to come back, and
 * every row the cap cut is below it, so `updated_at >= watermark` never offers
 * them again. The portal's failure is quieter but not smaller — a count, a chart
 * band and a CSV export all read as complete while missing everything past the
 * cap. Ordering by a column plus the primary key makes the pages a stable
 * sequence; the tiebreak matters because rows sharing a sort value would
 * otherwise shuffle between pages and one could fall through the seam.
 *
 * Lives here rather than in `syncService` because the admin portal needs it too,
 * and must not import the offline engine — `syncService` pulls in
 * `localDatabase`, and with it Capacitor SQLite, which has no business in the
 * portal bundle.
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
