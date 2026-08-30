import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { SortKey, SortState } from '../types/sort';
import type { SlabIndex } from '../types/slab';

const SORT_THRESHOLD_STORAGE_KEY = 'cardinal.sortThreshold';
const DEEP_SORT_THRESHOLD_STORAGE_KEY = 'cardinal.deepSortThreshold';
export const DEFAULT_SORTABLE_RESULT_THRESHOLD = 20000;
// Sorting by size with the disk walk turned on has to finish walking every folder in the result
// set before the order means anything, and those are the directories left out of the index for
// being enormous. Low on purpose: this is the "which folder is eating my disk" case, where the
// result set is small and the wait is the point.
export const DEFAULT_DEEP_SORTABLE_RESULT_THRESHOLD = 2000;

const clampSortThreshold = (value: number, fallback: number): number => {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.round(value);
  return Math.max(1, rounded);
};

const readStoredThreshold = (key: string, fallback: number): number => {
  if (typeof window === 'undefined') {
    return fallback;
  }
  const stored = window.localStorage.getItem(key);
  if (stored == null) {
    return fallback;
  }
  const parsed = Number.parseInt(stored, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return clampSortThreshold(parsed, fallback);
};

const persistThreshold = (key: string, value: number): void => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Ignore storage failures.
  }
};

export type UseRemoteSortOptions = {
  results: SlabIndex[];
  resultsVersion: number;
  locale: string;
  /** Folder totals are being shown, so they are what a sort by size has to order on. */
  folderSizes: boolean;
  /** Those totals are also being completed by the background disk walk. */
  deepFolderSizes: boolean;
  formatDisabledTooltip: (limit: string) => string | null;
  formatSizeDisabledTooltip: (limit: string) => string | null;
};

export type RemoteSortControls = {
  sortState: SortState;
  displayedResults: SlabIndex[];
  // Monotonic token for consumers that must invalidate when visible rows/order changes.
  displayedResultsVersion: number;
  sortThreshold: number;
  setSortThreshold: (value: number) => void;
  deepSortThreshold: number;
  setDeepSortThreshold: (value: number) => void;
  /** The sort queued the disk walks for every result, so viewport requests must not restart them. */
  deepSortOwnsWalks: boolean;
  canSort: boolean;
  isSorting: boolean;
  sortDisabledTooltip: string | null;
  sortButtonsDisabled: boolean;
  /** Set when every other column can be sorted but size cannot. */
  sizeSortDisabledTooltip: string | null;
  /** Re-orders on the totals known right now, without restarting any walk. */
  refreshSort: () => void;
  handleSortToggle: (key: SortKey) => void;
};

export const useRemoteSort = ({
  results,
  resultsVersion,
  locale,
  folderSizes,
  deepFolderSizes,
  formatDisabledTooltip,
  formatSizeDisabledTooltip,
}: UseRemoteSortOptions): RemoteSortControls => {
  const [sortState, setSortState] = useState<SortState>(null);
  const [sortedResults, setSortedResults] = useState<SlabIndex[]>([]);
  const [sortThreshold, setSortThresholdState] = useState<number>(() =>
    readStoredThreshold(SORT_THRESHOLD_STORAGE_KEY, DEFAULT_SORTABLE_RESULT_THRESHOLD),
  );
  const [deepSortThreshold, setDeepSortThresholdState] = useState<number>(() =>
    readStoredThreshold(DEEP_SORT_THRESHOLD_STORAGE_KEY, DEFAULT_DEEP_SORTABLE_RESULT_THRESHOLD),
  );
  const [isSorting, setIsSorting] = useState(false);
  const sortRequestRef = useRef(0);
  // Separate from backend `resultsVersion`: also bumps when sorted/non-sorted projection flips.
  const [displayedResultsVersion, bumpDisplayedResultsVersion] = useReducer(
    (version: number) => version + 1,
    0,
  );

  const canSort = results.length <= sortThreshold;
  // The walk is the only part that needs its own ceiling. Summing the index is bounded by the
  // index, which already leaves out the expensive directories; walking them is not bounded by
  // anything, so it gets a limit of its own rather than borrowing the general one.
  const canSortBySizeDeeply = !deepFolderSizes || results.length <= deepSortThreshold;
  const canSortBySize = canSort && canSortBySizeDeeply;
  const deepSortActive = Boolean(deepFolderSizes && canSortBySize && sortState?.key === 'size');

  const shouldUseSortedResults = Boolean(sortState && canSort);
  const displayedResults = shouldUseSortedResults ? sortedResults : results;

  const setSortThreshold = useCallback((value: number) => {
    const normalized = clampSortThreshold(value, DEFAULT_SORTABLE_RESULT_THRESHOLD);
    setSortThresholdState(normalized);
    persistThreshold(SORT_THRESHOLD_STORAGE_KEY, normalized);
  }, []);

  const setDeepSortThreshold = useCallback((value: number) => {
    const normalized = clampSortThreshold(value, DEFAULT_DEEP_SORTABLE_RESULT_THRESHOLD);
    setDeepSortThresholdState(normalized);
    persistThreshold(DEEP_SORT_THRESHOLD_STORAGE_KEY, normalized);
  }, []);

  const handleSortToggle = useCallback(
    (nextKey: SortKey) => {
      if (!canSort || (nextKey === 'size' && !canSortBySize)) {
        return;
      }
      setSortState((prev) => {
        if (!prev || prev.key !== nextKey) {
          return { key: nextKey, direction: 'asc' };
        }
        if (prev.direction === 'asc') {
          return { key: nextKey, direction: 'desc' };
        }
        return null;
      });
    },
    [canSort, canSortBySize],
  );

  useEffect(() => {
    if (!canSort && sortState) {
      setSortState(null);
    }
  }, [canSort, sortState]);

  // Turning the walk on, or growing the result set past its limit, has to give up a sort by size
  // that can no longer be honoured — otherwise the rows keep an order nothing is maintaining.
  useEffect(() => {
    if (sortState?.key === 'size' && !canSortBySize) {
      setSortState(null);
    }
  }, [canSortBySize, sortState]);

  const runSort = useCallback(
    (queueDeepWalks: boolean) => {
      const requestId = sortRequestRef.current + 1;
      sortRequestRef.current = requestId;

      if (!sortState || !canSort || results.length === 0) {
        setIsSorting(false);
        setSortedResults(results);
        return;
      }

      setIsSorting(true);

      void (async () => {
        try {
          const ordered = await invoke<number[]>('get_sorted_view', {
            results,
            sort: sortState,
            // Only a sort by size needs the totals, and computing them is a walk of the index.
            folderSizes: folderSizes && sortState.key === 'size',
            deepFolderSizes: queueDeepWalks,
          });
          if (sortRequestRef.current === requestId) {
            setSortedResults(ordered as SlabIndex[]);
            bumpDisplayedResultsVersion();
          }
        } finally {
          if (sortRequestRef.current === requestId) {
            setIsSorting(false);
          }
        }
      })();
    },
    [results, sortState, canSort, folderSizes, bumpDisplayedResultsVersion],
  );

  useEffect(() => {
    // ponytail-keep: this run is the one allowed to queue the walks, and the refresh below is not.
    // Each request opens a new folder-size generation that cancels the previous one, so re-running
    // it on every progress event would abort the very walks whose progress triggered it — the
    // totals would restart from the indexed sum forever and never finish.
    runSort(deepSortActive);
  }, [runSort, deepSortActive]);

  const refreshSort = useCallback(() => {
    runSort(false);
  }, [runSort]);

  useEffect(() => {
    bumpDisplayedResultsVersion();
  }, [resultsVersion, shouldUseSortedResults]);

  const sortLimitLabel = useMemo(
    () => new Intl.NumberFormat(locale).format(sortThreshold),
    [locale, sortThreshold],
  );
  const deepSortLimitLabel = useMemo(
    () => new Intl.NumberFormat(locale).format(deepSortThreshold),
    [locale, deepSortThreshold],
  );
  const sortDisabledTooltip = canSort ? null : formatDisabledTooltip(sortLimitLabel);
  const sizeSortDisabledTooltip =
    canSort && !canSortBySizeDeeply ? formatSizeDisabledTooltip(deepSortLimitLabel) : null;
  const sortButtonsDisabled = !canSort || isSorting;

  return {
    sortState,
    displayedResults,
    displayedResultsVersion,
    sortThreshold,
    setSortThreshold,
    deepSortThreshold,
    setDeepSortThreshold,
    deepSortOwnsWalks: deepSortActive,
    canSort,
    isSorting,
    sortDisabledTooltip,
    sortButtonsDisabled,
    sizeSortDisabledTooltip,
    refreshSort,
    handleSortToggle,
  };
};
