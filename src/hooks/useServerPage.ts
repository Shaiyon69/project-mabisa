import { useEffect, useRef, useState } from 'react';
import { ROWS_PER_PAGE } from '../components/common/Table';
import { supabase } from '../lib/supabase';
import type { Page } from '../services/adminData';

type Settled<Row> = Page<Row> & { offset: number; error: string | null; settledFor: string };

/**
 * The last page each list read, by scope and page number. Coming back to a
 * sidebar tab shows it at once while the same page re-reads behind it, instead
 * of an empty table for a round trip.
 */
const lastPages = new Map<string, Settled<unknown>>();

// RLS narrowed these rows to whoever was signed in.
supabase.auth.onAuthStateChange(() => lastPages.clear());

type ServerPageOptions = {
  /** Re-reads the page in view without leaving it, e.g. after a write. */
  reloadToken?: string | number;
  /** Waits this long after the last change before reading, for a search box. */
  delayMs?: number;
};

/**
 * One list paged by the server. `scopeKey` must name every input `fetchPage`
 * reads, and the list itself: a new one goes back to page 1, it is what
 * triggers a read, and it keys the cache above.
 */
export function useServerPage<Row>(
  scopeKey: string,
  fetchPage: (limit: number, offset: number) => Promise<Page<Row>>,
  { reloadToken = 0, delayMs = 0 }: ServerPageOptions = {},
) {
  const [page, setPage] = useState(1);
  const [pagedScope, setPagedScope] = useState(scopeKey);
  // `offset` belongs to the rows in hand, so numbering never runs ahead of the data.
  const [result, setResult] = useState<Settled<Row>>(
    () =>
      (lastPages.get(`${scopeKey}|1`) as Settled<Row> | undefined) ?? {
        rows: [],
        total: 0,
        offset: 0,
        error: null,
        settledFor: '',
      },
  );
  // The debounce is for typing: a first read or a page turn goes out at once.
  const debouncedScope = useRef(scopeKey);
  // Held so a caller's inline function does not re-trigger the read on every render.
  const latestFetch = useRef(fetchPage);

  // Reset during render, so no request goes out at the old scope's offset.
  if (pagedScope !== scopeKey) {
    setPagedScope(scopeKey);
    setPage(1);
  }

  const cacheKey = `${scopeKey}|${page}`;
  const requestKey = `${cacheKey}|${reloadToken}`;
  // Cached rows for this page count as settled; the re-read behind them updates quietly.
  const loading = result.settledFor !== requestKey && !result.settledFor.startsWith(`${cacheKey}|`);
  const pageCount = Math.max(1, Math.ceil(result.total / ROWS_PER_PAGE));

  // A write or a shrinking list can leave fewer pages than the one in view.
  if (!loading && !result.error && page > pageCount) {
    setPage(pageCount);
  }

  useEffect(() => {
    latestFetch.current = fetchPage;
  });

  useEffect(() => {
    let current = true;
    const wait = debouncedScope.current === scopeKey ? 0 : delayMs;

    debouncedScope.current = scopeKey;

    const timer = setTimeout(() => {
      const offset = (page - 1) * ROWS_PER_PAGE;

      latestFetch.current(ROWS_PER_PAGE, offset)
        .then((next) => {
          if (current) {
            const settled = { ...next, offset, error: null, settledFor: requestKey };

            lastPages.set(cacheKey, settled);
            setResult(settled);
          }
        })
        .catch((cause: unknown) => {
          if (current) {
            setResult((previous) => ({
              ...previous,
              error: cause instanceof Error ? cause.message : 'Could not read this list.',
              settledFor: requestKey,
            }));
          }
        });
    }, wait);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [page, requestKey, cacheKey, scopeKey, delayMs]);

  return {
    rows: result.rows,
    total: result.total,
    error: result.error,
    loading,
    page,
    pageCount,
    setPage,
    offset: result.offset,
  };
}
