import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';
import { secureStorage } from './secureStorage';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * What an expired or already-used reset link left in the address bar. Read here,
 * before `createClient` below strips the fragment, or the person lands on the
 * sign-in screen with nothing to say why the link did not work.
 */
export const authLinkError =
  typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.hash.slice(1)).get('error_description');

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

type PageResponse<TRow> = PromiseLike<{ data: TRow[] | null; error: { message: string } | null }>;

/** A select the reader can narrow to one page: the rows past a cursor, in key order. */
type KeysetQuery<TRow> = {
  gt(column: string, value: string): { order(column: string): { limit(count: number): PageResponse<TRow> } };
  order(column: string): { limit(count: number): PageResponse<TRow> };
};

/**
 * Reads one table to the end, a page at a time, keyed on `key`.
 *
 * A single `select('*')` stops at the server's row cap and says nothing about it:
 * on the phone the pull watermark then advances past rows it never saw, and on
 * the portal a count or an export reads as complete while missing them. Paging
 * on the key rather than an offset survives a row inserted mid-read, which
 * shifts every later offset down one and drops a row from the results.
 *
 * Pages come back in key order, so a caller wanting another order sorts for it.
 * `query` is called once per page, since a builder cannot be reused.
 *
 * Lives here rather than in `syncService`, which the portal must not import.
 */
export async function readAllPages<TRow>(label: string, key: string, query: () => KeysetQuery<TRow>): Promise<TRow[]> {
  const rows: TRow[] = [];
  let cursor: string | null = null;

  for (;;) {
    const select = query();
    const { data, error } = await (cursor === null ? select : select.gt(key, cursor)).order(key).limit(PULL_PAGE_SIZE);

    if (error) {
      throw new Error(`${label} Pull Error: ${error.message}`);
    }

    const page = data ?? [];

    rows.push(...page);

    // A short page is the last page — a full one might not be, so ask again.
    if (page.length < PULL_PAGE_SIZE) {
      return rows;
    }

    const next: string = String((page[page.length - 1] as Record<string, unknown>)[key]);

    // A server ignoring the cursor would hand back the same page forever.
    if (cursor !== null && next <= cursor) {
      throw new Error(`${label} Pull Error: page did not advance past ${cursor}`);
    }

    cursor = next;
  }
}
