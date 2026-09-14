import { useEffect, useRef, useState } from 'react';
import { ROWS_PER_PAGE } from '../components/common/Table';
import type { Page } from '../services/adminData';

type ServerPageOptions = {
  /** Re-reads the page in view without leaving it, e.g. after a write. */
  reloadToken?: string | number;
  /** Waits this long after the last change before reading, for a search box. */
  delayMs?: number;
};

/**
 * One list paged by the server. `scopeKey` must name every input `fetchPage`
 * reads: a new one goes back to page 1, and it is what triggers a read.
 */
export function useServerPage<Row>(
  scopeKey: string,
  fetchPage: (limit: number, offset: number) => Promise<Page<Row>>,
  { reloadToken = 0, delayMs = 0 }: ServerPageOptions = {},
) {
  const [page, setPage] = useState(1);
  const [pagedScope, setPagedScope] = useState(scopeKey);
  // `offset` belongs to the rows in hand, so numbering never runs ahead of the data.
  const [result, setResult] = useState<Page<Row> & { offset: number; error: string | null; settledFor: string }>({
    rows: [],
    total: 0,
    offset: 0,
    error: null,
    settledFor: '',
  });
  // Held so a caller's inline function does not re-trigger the read on every render.
  const latestFetch = useRef(fetchPage);

  // Reset during render, so no request goes out at the old scope's offset.
  if (pagedScope !== scopeKey) {
    setPagedScope(scopeKey);
    setPage(1);
  }

  const requestKey = `${scopeKey}|${page}|${reloadToken}`;
  const loading = result.settledFor !== requestKey;
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

    const timer = setTimeout(() => {
      const offset = (page - 1) * ROWS_PER_PAGE;

      latestFetch.current(ROWS_PER_PAGE, offset)
        .then((next) => {
          if (current) {
            setResult({ ...next, offset, error: null, settledFor: requestKey });
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
    }, delayMs);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [page, requestKey, delayMs]);

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
