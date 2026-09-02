import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FILTER_PARAMS,
  defaultAdminFilters,
  emptyAdminSnapshot,
  fetchAdminSnapshot,
  type AdminFilters,
  type AdminSnapshot,
} from '../services/adminData';

/** How often an open portal re-reads. Slow enough to stay a monitor, not a poller. */
const AUTO_REFRESH_MS = 60_000;

export type AdminData = {
  snapshot: AdminSnapshot;
  filters: AdminFilters;
  setFilters: (filters: AdminFilters) => void;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

/**
 * Every narrow filter off the URL, read generically off `FILTER_PARAMS`. Absent
 * means unset. `reportSections` rides separately as a comma-joined `sections`
 * param, since it is a list rather than a single value.
 */
export function filtersFromParams(params: URLSearchParams): AdminFilters {
  const fallback = defaultAdminFilters();

  // Each key in `FILTER_PARAMS` carries its own literal union, and a value off
  // the query string is only a raw string, so the object is built loosely and
  // cast once at the end.
  const filters: Record<string, unknown> = {
    from: params.get('from') ?? fallback.from,
    to: params.get('to') ?? fallback.to,
  };

  for (const [key, param] of FILTER_PARAMS) {
    filters[key] = params.get(param) || null;
  }

  const sections = params.get('sections');
  filters.reportSections = sections ? sections.split(',') : null;

  return filters as AdminFilters;
}

/** The inverse of `filtersFromParams`, dropping an unset key rather than writing it empty. */
export function paramsFromFilters(current: URLSearchParams, next: AdminFilters): URLSearchParams {
  const updated = new URLSearchParams(current);

  updated.set('from', next.from);
  updated.set('to', next.to);

  for (const [key, param] of FILTER_PARAMS) {
    const value = next[key];

    if (value) {
      updated.set(param, String(value));
    } else {
      updated.delete(param);
    }
  }

  if (next.reportSections?.length) {
    updated.set('sections', next.reportSections.join(','));
  } else {
    updated.delete('sections');
  }

  return updated;
}

export type AdminFiltersState = {
  filters: AdminFilters;
  setFilters: (filters: AdminFilters) => void;
};

/**
 * Filter state alone, with no snapshot attached, for a screen like Accounts that
 * wants the drawer without the full households and assessments read.
 *
 * The filters live in the query string, so a scope survives a reload, travels
 * with a link between screens, and can be pasted to a colleague.
 */
export function useAdminFilters(): AdminFiltersState {
  const [params, setParams] = useSearchParams();

  const filters = useMemo(() => filtersFromParams(params), [params]);

  // `replace`, so changing a filter adds no back-button step.
  const setFilters = useCallback(
    (next: AdminFilters) => {
      setParams((current) => paramsFromFilters(current, next), { replace: true });
    },
    [setParams],
  );

  return { filters, setFilters };
}

/**
 * Central data for one admin screen, refetched whenever a filter changes. Each
 * page reads its own scope rather than sharing a provider, and callers get the
 * snapshot and the filters that produced it from the same hook.
 */
export function useAdminData(): AdminData {
  const { filters, setFilters } = useAdminFilters();
  const [reloadToken, setReloadToken] = useState(0);

  const [result, setResult] = useState<{ snapshot: AdminSnapshot; error: string | null; settledFor: string }>({
    snapshot: emptyAdminSnapshot,
    error: null,
    settledFor: '',
  });

  // The scope this render is asking for: every key in `FILTER_PARAMS`, plus
  // `from`/`to` and `reportSections`. A filter missing here never triggers a
  // refetch. Derived rather than set in the effect, so `loading` is the
  // difference between it and the scope the state last settled against. The
  // reload token stays out, so a re-read of the same scope keeps the numbers up.
  const filterKey = [
    filters.from,
    filters.to,
    ...FILTER_PARAMS.map(([key]) => filters[key] ?? 'none'),
    filters.reportSections?.join(',') ?? 'none',
  ].join('|');
  const requestKey = `${filterKey}|${reloadToken}`;
  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  // Re-reads on its own, since BHWs write to the database all day. Only while the
  // tab is in front, with the visibility listener catching the return.
  useEffect(() => {
    const reread = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    const timer = window.setInterval(reread, AUTO_REFRESH_MS);

    document.addEventListener('visibilitychange', reread);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', reread);
    };
  }, [refresh]);

  useEffect(() => {
    // Guards against a scope changing mid-flight and the slower response landing last.
    let current = true;

    fetchAdminSnapshot(filters)
      .then((snapshot) => {
        if (current) {
          setResult({ snapshot, error: null, settledFor: filterKey });
        }
      })
      .catch((cause: unknown) => {
        if (current) {
          setResult((previous) => ({
            ...previous,
            error: cause instanceof Error ? cause.message : 'Could not read the central database.',
            settledFor: filterKey,
          }));
        }
      });

    return () => {
      current = false;
    };
    // `filterKey` is already a substring of `requestKey`, so listing it adds no
    // re-runs; it is here only to satisfy the lint rule.
  }, [filters, requestKey, filterKey]);

  return {
    snapshot: result.snapshot,
    filters,
    setFilters,
    loading: result.settledFor !== filterKey,
    error: result.error,
    refresh,
  };
}
