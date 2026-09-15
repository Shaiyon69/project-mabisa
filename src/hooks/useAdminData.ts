import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FILTER_PARAMS,
  defaultAdminFilters,
  emptyAdminSnapshot,
  fetchAdminScope,
  fetchAdminSnapshot,
  invalidateAdminSnapshot,
  type AdminFilters,
  type AdminScope,
  type AdminSnapshot,
} from '../services/adminData';
import { isCalendarDate } from '../lib/utils';

/** How often an open portal re-reads. Each re-read downloads the period again, so it stays minutes apart. */
const AUTO_REFRESH_MS = 5 * 60_000;

type AdminData = {
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
  //
  // The period is the one pair that must be a real date: it reaches `monthsIn`,
  // which builds a `Date` from it and calls `toISOString()`, so a malformed value
  // throws during render rather than failing a fetch. An unusable one falls back
  // to the default period instead.
  const from = params.get('from');
  const to = params.get('to');
  const filters: Record<string, unknown> = {
    from: isCalendarDate(from) ? from : fallback.from,
    to: isCalendarDate(to) ? to : fallback.to,
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

type AdminFiltersState = {
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

type AdminRead<T> = {
  filters: AdminFilters;
  setFilters: (filters: AdminFilters) => void;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  data: T;
};

/**
 * One admin read, refetched whenever a filter in `filterKeyOf` changes and on the
 * auto-refresh. Filters live in the query string, so callers get the read and the
 * filters that produced it from the same hook.
 */
function useAdminRead<T>(
  read: (filters: AdminFilters) => Promise<T>,
  empty: T,
  filterKeyOf: (filters: AdminFilters) => string,
): AdminRead<T> {
  const { filters, setFilters } = useAdminFilters();
  const [reloadToken, setReloadToken] = useState(0);
  const [result, setResult] = useState<{ data: T; error: string | null; settledFor: string }>({
    data: empty,
    error: null,
    settledFor: '',
  });
  const lastRefresh = useRef(0);

  // The reload token stays out of `filterKey`, so a re-read of the same scope keeps the numbers up.
  const filterKey = filterKeyOf(filters);
  const requestKey = `${filterKey}|${reloadToken}`;
  const latestRead = useRef(read);

  // Drops the cached reads first: a refresh is precisely the request to go past them.
  const refresh = useCallback(() => {
    invalidateAdminSnapshot();
    lastRefresh.current = Date.now();
    setReloadToken((token) => token + 1);
  }, []);

  // Re-reads on its own while the tab is in front. Returning to the tab re-reads only once the interval has passed.
  useEffect(() => {
    lastRefresh.current = Date.now();

    const reread = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current >= AUTO_REFRESH_MS) refresh();
    };

    const timer = window.setInterval(reread, AUTO_REFRESH_MS);

    document.addEventListener('visibilitychange', reread);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', reread);
    };
  }, [refresh]);

  useEffect(() => {
    latestRead.current = read;
  });

  useEffect(() => {
    // Guards against a scope changing mid-flight and the slower response landing last.
    let current = true;

    latestRead
      .current(filters)
      .then((data) => {
        if (current) {
          setResult({ data, error: null, settledFor: filterKey });
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
  }, [filters, requestKey, filterKey]);

  return { filters, setFilters, loading: result.settledFor !== filterKey, error: result.error, refresh, data: result.data };
}

/** Every filter the snapshot narrows by. A filter missing here never triggers a refetch. */
function snapshotKey(filters: AdminFilters): string {
  return [
    filters.from,
    filters.to,
    ...FILTER_PARAMS.map(([key]) => filters[key] ?? 'none'),
    filters.reportSections?.join(',') ?? 'none',
  ].join('|');
}

/** Central data for one admin screen: the period's field data, narrowed to the filters. */
export function useAdminData(): AdminData {
  const { data, ...rest } = useAdminRead(fetchAdminSnapshot, emptyAdminSnapshot, snapshotKey);

  return { ...rest, snapshot: data };
}

const emptyScope: AdminScope & { fetchedAt: string } = {
  barangays: [],
  puroks: [],
  sessionBarangayId: null,
  barangayLabel: '',
  fetchedAt: emptyAdminSnapshot.fetchedAt,
};

/** Filters plus the barangay and purok lists, for a screen whose tables page on the server and need no snapshot. */
export function useAdminScope() {
  const { data, ...rest } = useAdminRead(
    () => fetchAdminScope().then((scope) => ({ ...scope, fetchedAt: new Date().toISOString() })),
    emptyScope,
    () => 'scope',
  );

  return { ...rest, scope: data };
}
