import { useCallback, useEffect, useState } from 'react';
import {
  defaultAdminFilters,
  emptyAdminSnapshot,
  fetchAdminSnapshot,
  type AdminFilters,
  type AdminSnapshot,
} from '../services/adminData';

export type AdminData = {
  snapshot: AdminSnapshot;
  filters: AdminFilters;
  setFilters: (filters: AdminFilters) => void;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

/**
 * Central data for one admin screen, refetched whenever the period changes.
 *
 * Filter state lives here rather than in a provider: each admin page asks its
 * own question over its own period, and the portal is a handful of screens on a
 * wired workstation, so a shared cache would buy less than it costs to keep in
 * step. Callers get the snapshot and the filters that produced it from the same
 * hook, which is what lets every summary caption state its period honestly.
 */
export function useAdminData(): AdminData {
  const [filters, setFilters] = useState<AdminFilters>(defaultAdminFilters);
  const [reloadToken, setReloadToken] = useState(0);
  const [result, setResult] = useState<{ snapshot: AdminSnapshot; error: string | null; settledFor: string }>({
    snapshot: emptyAdminSnapshot,
    error: null,
    settledFor: '',
  });

  // The request this render is asking for. `loading` is the difference between
  // it and the request the state was last settled against, rather than a flag
  // set in the effect body — a new period makes the screen busy on the render
  // that changed it, with no second render to get there.
  const requestKey = `${filters.from}|${filters.to}|${reloadToken}`;
  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    // A period changed mid-flight would otherwise let the slower of the two
    // responses land last and caption itself with the newer filters.
    let current = true;

    fetchAdminSnapshot(filters)
      .then((snapshot) => {
        if (current) {
          setResult({ snapshot, error: null, settledFor: requestKey });
        }
      })
      .catch((cause: unknown) => {
        if (current) {
          setResult((previous) => ({
            ...previous,
            error: cause instanceof Error ? cause.message : 'Could not read the central database.',
            settledFor: requestKey,
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
    loading: result.settledFor !== requestKey,
    error: result.error,
    refresh,
  };
}
