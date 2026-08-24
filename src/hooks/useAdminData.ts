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
 * Filter state lives here, not in a provider — each page asks its own question
 * over its own period, and gets the snapshot and filters from the same hook.
 */
export function useAdminData(): AdminData {
  const [filters, setFilters] = useState<AdminFilters>(defaultAdminFilters);
  const [reloadToken, setReloadToken] = useState(0);
  const [result, setResult] = useState<{ snapshot: AdminSnapshot; error: string | null; settledFor: string }>({
    snapshot: emptyAdminSnapshot,
    error: null,
    settledFor: '',
  });

  // `loading` is this key vs. the one state last settled against — not a flag set
  // in the effect body — so a new period is busy on the render that changed it.
  const requestKey = `${filters.from}|${filters.to}|${reloadToken}`;
  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    // Guards against a period changing mid-flight and the slower response landing last.
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
