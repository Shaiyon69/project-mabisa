import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
 *
 * The period is held in the query string rather than in component state, because
 * a dashboard tile that links to another screen has to carry its period there.
 * Without that, clicking "Assessments 23" for a two-week period lands on Reports
 * showing the year to date — a different number under the same heading, which is
 * worse than no link. Held in the URL it also survives a reload and can be sent
 * to a colleague, and there is one source of truth instead of state plus a param.
 */
export function useAdminData(): AdminData {
  const [params, setParams] = useSearchParams();
  const [reloadToken, setReloadToken] = useState(0);

  const filters = useMemo<AdminFilters>(() => {
    const fallback = defaultAdminFilters();

    return {
      from: params.get('from') ?? fallback.from,
      to: params.get('to') ?? fallback.to,
      // Absent means every barangay the session may read, which is what an
      // unfiltered portal shows. It rides in the URL for the same reason the
      // period does: a tile that links to another screen has to carry it.
      barangayId: params.get('barangay') || null,
    };
  }, [params]);

  // `replace`, so changing the period does not put a back-button step between
  // the officer and the screen they arrived from.
  const setFilters = useCallback(
    (next: AdminFilters) => {
      setParams(
        (current) => {
          const updated = new URLSearchParams(current);

          updated.set('from', next.from);
          updated.set('to', next.to);

          if (next.barangayId) {
            updated.set('barangay', next.barangayId);
          } else {
            updated.delete('barangay');
          }

          return updated;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const [result, setResult] = useState<{ snapshot: AdminSnapshot; error: string | null; settledFor: string }>({
    snapshot: emptyAdminSnapshot,
    error: null,
    settledFor: '',
  });

  // The request this render is asking for. `loading` is the difference between
  // it and the request the state was last settled against, rather than a flag
  // set in the effect body — a new period makes the screen busy on the render
  // that changed it, with no second render to get there.
  const requestKey = `${filters.from}|${filters.to}|${filters.barangayId ?? 'all'}|${reloadToken}`;
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
