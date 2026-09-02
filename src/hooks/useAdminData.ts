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
 * Every narrow filter off the URL, read generically off `FILTER_PARAMS`
 * instead of naming each key by hand — a filter added to that table starts
 * round-tripping through the query string with no other change needed here.
 * Absent means unset for every one of them, which is what an unfiltered
 * screen shows. `reportSections` rides separately as a comma-joined
 * `sections` param, because it is a list rather than a single value and is
 * the one key `FILTER_PARAMS` deliberately excludes.
 *
 * Exported alongside its inverse below so the round trip is testable as plain
 * `URLSearchParams` logic without rendering the hook — this project's test
 * runner carries no DOM, and `useSearchParams` needs a router mounted around it.
 */
export function filtersFromParams(params: URLSearchParams): AdminFilters {
  const fallback = defaultAdminFilters();

  // `FILTER_PARAMS` pairs a specific key with a specific literal union —
  // `sex` with `IndividualSex`, `accountRole` with `UserRole`, and so on — but
  // a value read off the query string is only ever a raw string, and the loop
  // has no way to prove it belongs to whichever union its key happens to
  // carry. The object is built loosely and cast once at the end instead; the
  // same trust boundary the period and the barangay already crossed unchecked.
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

/** The inverse of `filtersFromParams`: merges a filter set onto an existing param bag, dropping a key that is unset rather than writing it empty. */
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
 * Filter state alone, with no snapshot attached.
 *
 * Split out of `useAdminData` for Accounts: that screen needs the filter
 * drawer's state to populate its role dropdown and to narrow the accounts it
 * already holds in memory, but pulling in `useAdminData` just for that would
 * trigger the full households + residents + assessments read on a screen that
 * renders none of them.
 *
 * The filters live in the query string rather than in component state for the
 * same reason `useAdminData` keeps them there: a dashboard tile that links to
 * another screen has to carry its scope with it, and a filtered view has to
 * survive a reload and be pasteable to a colleague.
 */
export function useAdminFilters(): AdminFiltersState {
  const [params, setParams] = useSearchParams();

  const filters = useMemo(() => filtersFromParams(params), [params]);

  // `replace`, so changing a filter does not put a back-button step between
  // the officer and the screen they arrived from.
  const setFilters = useCallback(
    (next: AdminFilters) => {
      setParams((current) => paramsFromFilters(current, next), { replace: true });
    },
    [setParams],
  );

  return { filters, setFilters };
}

/**
 * Central data for one admin screen, refetched whenever a filter changes.
 *
 * Filter state lives in `useAdminFilters` rather than in a provider: each
 * admin page asks its own question over its own scope, and the portal is a
 * handful of screens on a wired workstation, so a shared cache would buy less
 * than it costs to keep in step. Callers get the snapshot and the filters
 * that produced it from the same hook, which is what lets every summary
 * caption state its scope honestly.
 */
export function useAdminData(): AdminData {
  const { filters, setFilters } = useAdminFilters();
  const [reloadToken, setReloadToken] = useState(0);

  const [result, setResult] = useState<{ snapshot: AdminSnapshot; error: string | null; settledFor: string }>({
    snapshot: emptyAdminSnapshot,
    error: null,
    settledFor: '',
  });

  // The scope this render is asking for, covering every key `FILTER_PARAMS`
  // knows about plus the two it doesn't — `from`/`to`, and `reportSections`,
  // which is a list rather than a single value. Missing a key here is the
  // failure the plan calls out by name: a narrow filter that changes without
  // changing this string never triggers a refetch, and `loading` never flips
  // because nothing here said a new scope had been asked for. It is a plain
  // derived value rather than a flag set in the effect body, so `loading` is
  // the difference between it and the scope the state was last settled
  // against — a new scope makes the screen busy on the render that changed
  // it, with no second render needed to get there. The reload token is
  // deliberately outside it: a re-read of the same scope keeps the numbers on
  // screen instead of blanking them into a spinner every minute.
  const filterKey = [
    filters.from,
    filters.to,
    ...FILTER_PARAMS.map(([key]) => filters[key] ?? 'none'),
    filters.reportSections?.join(',') ?? 'none',
  ].join('|');
  const requestKey = `${filterKey}|${reloadToken}`;
  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  // The portal is a monitor of a database the BHWs are writing to all day, so it
  // re-reads on its own rather than waiting to be asked. Only while the tab is
  // in front: a portal left open on a workstation overnight should not spend the
  // night polling, and the visibility listener re-reads the moment it returns,
  // which is the case a timer alone handles worst.
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
  }, [filters, requestKey]);

  return {
    snapshot: result.snapshot,
    filters,
    setFilters,
    loading: result.settledFor !== filterKey,
    error: result.error,
    refresh,
  };
}
