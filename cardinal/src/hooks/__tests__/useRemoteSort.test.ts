import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { SlabIndex } from '../../types/slab';
import { useRemoteSort } from '../useRemoteSort';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

const toSlabIndices = (values: number[]): SlabIndex[] => values.map((value) => value as SlabIndex);

const createDeferred = () => {
  let resolve: (value: SlabIndex[]) => void = () => {};
  const promise = new Promise<SlabIndex[]>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const sortOptions = (
  overrides: Partial<Parameters<typeof useRemoteSort>[0]>,
): Parameters<typeof useRemoteSort>[0] => ({
  results: [],
  resultsVersion: 1,
  locale: 'en-US',
  folderSizes: false,
  deepFolderSizes: false,
  formatDisabledTooltip: () => null,
  formatSizeDisabledTooltip: () => null,
  ...overrides,
});

describe('useRemoteSort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();

    mockedInvoke.mockImplementation((command: string) => {
      if (command === 'get_sorted_view') {
        return Promise.resolve(toSlabIndices([2, 1, 0]));
      }
      return Promise.resolve(null);
    });
  });

  it('bumps displayedResultsVersion when sort projection changes without backend version changes', async () => {
    const results = toSlabIndices([0, 1, 2]);
    const { result } = renderHook(() => useRemoteSort(sortOptions({ results, resultsVersion: 1 })));

    await waitFor(() => {
      expect(result.current.displayedResultsVersion).toBeGreaterThan(0);
    });
    const beforeSortVersion = result.current.displayedResultsVersion;

    act(() => {
      result.current.handleSortToggle('filename');
    });

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('get_sorted_view', {
        results,
        sort: { key: 'filename', direction: 'asc' },
        folderSizes: false,
        deepFolderSizes: false,
      });
    });
    await waitFor(() => {
      expect(result.current.displayedResultsVersion).toBeGreaterThan(beforeSortVersion);
    });
  });

  it('bumps displayedResultsVersion when backend resultsVersion increments', async () => {
    const first = toSlabIndices([0, 1, 2]);
    const next = toSlabIndices([10, 11, 12]);

    const { result, rerender } = renderHook(
      ({ items, version }: { items: SlabIndex[]; version: number }) =>
        useRemoteSort(sortOptions({ results: items, resultsVersion: version })),
      {
        initialProps: {
          items: first,
          version: 1,
        },
      },
    );

    await waitFor(() => {
      expect(result.current.displayedResultsVersion).toBeGreaterThan(0);
    });
    const beforeRefreshVersion = result.current.displayedResultsVersion;

    act(() => {
      rerender({
        items: next,
        version: 2,
      });
    });

    await waitFor(() => {
      expect(result.current.displayedResultsVersion).toBeGreaterThan(beforeRefreshVersion);
    });
    expect(result.current.displayedResults).toEqual(next);
  });

  it('does not sort remotely when the result count exceeds threshold', async () => {
    window.localStorage.setItem('cardinal.sortThreshold', '2');
    const results = toSlabIndices([0, 1, 2]);
    const { result } = renderHook(() => useRemoteSort(sortOptions({ results, resultsVersion: 1 })));

    act(() => {
      result.current.handleSortToggle('filename');
    });

    await waitFor(() => {
      expect(result.current.sortState).toBeNull();
    });
    expect(mockedInvoke).not.toHaveBeenCalledWith(
      'get_sorted_view',
      expect.objectContaining({ results }),
    );
    expect(result.current.displayedResults).toEqual(results);
  });

  it('preserves current sort state when result count stays within threshold (including empty results)', async () => {
    const initial = toSlabIndices([0, 1, 2]);

    const { result, rerender } = renderHook(
      ({ items, version }: { items: SlabIndex[]; version: number }) =>
        useRemoteSort(sortOptions({ results: items, resultsVersion: version })),
      {
        initialProps: {
          items: initial,
          version: 1,
        },
      },
    );

    act(() => {
      result.current.handleSortToggle('filename');
    });

    await waitFor(() => {
      expect(result.current.sortState).toEqual({ key: 'filename', direction: 'asc' });
    });

    act(() => {
      rerender({
        items: [],
        version: 2,
      });
    });

    await waitFor(() => {
      expect(result.current.sortState).toEqual({ key: 'filename', direction: 'asc' });
    });
    expect(result.current.displayedResults).toEqual([]);
  });

  it('allows toggling sort state for empty results without remote sorting', async () => {
    const empty: SlabIndex[] = [];
    const { result } = renderHook(() =>
      useRemoteSort(sortOptions({ results: empty, resultsVersion: 1 })),
    );

    expect(result.current.sortButtonsDisabled).toBe(false);

    act(() => {
      result.current.handleSortToggle('filename');
    });

    await waitFor(() => {
      expect(result.current.sortState).toEqual({ key: 'filename', direction: 'asc' });
    });
    expect(result.current.displayedResults).toEqual(empty);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it('clears current sort state when result count exceeds threshold', async () => {
    window.localStorage.setItem('cardinal.sortThreshold', '2');
    const initial = toSlabIndices([0, 1]);
    const overLimit = toSlabIndices([0, 1, 2]);

    const { result, rerender } = renderHook(
      ({ items, version }: { items: SlabIndex[]; version: number }) =>
        useRemoteSort(sortOptions({ results: items, resultsVersion: version })),
      {
        initialProps: {
          items: initial,
          version: 1,
        },
      },
    );

    act(() => {
      result.current.handleSortToggle('filename');
    });

    await waitFor(() => {
      expect(result.current.sortState).toEqual({ key: 'filename', direction: 'asc' });
    });

    act(() => {
      rerender({
        items: overLimit,
        version: 2,
      });
    });

    await waitFor(() => {
      expect(result.current.sortState).toBeNull();
    });
  });

  it('bumps displayedResultsVersion when switching sorted projection on then off', async () => {
    const results = toSlabIndices([0, 1, 2]);
    const { result } = renderHook(() => useRemoteSort(sortOptions({ results, resultsVersion: 1 })));

    await waitFor(() => {
      expect(result.current.displayedResultsVersion).toBeGreaterThan(0);
    });
    const initialVersion = result.current.displayedResultsVersion;

    act(() => {
      result.current.handleSortToggle('filename');
    });
    await waitFor(() => {
      expect(result.current.sortState).toEqual({ key: 'filename', direction: 'asc' });
    });
    await waitFor(() => {
      expect(result.current.displayedResultsVersion).toBeGreaterThan(initialVersion);
    });
    const sortedVersion = result.current.displayedResultsVersion;

    act(() => {
      result.current.handleSortToggle('filename');
    });
    await waitFor(() => {
      expect(result.current.sortState).toEqual({ key: 'filename', direction: 'desc' });
    });

    act(() => {
      result.current.handleSortToggle('filename');
    });
    await waitFor(() => {
      expect(result.current.sortState).toBeNull();
    });
    await waitFor(() => {
      expect(result.current.displayedResultsVersion).toBeGreaterThan(sortedVersion);
    });
  });

  it('ignores stale remote sort responses and applies only the latest request', async () => {
    const results = toSlabIndices([0, 1, 2]);
    const firstRequest = createDeferred();
    const secondRequest = createDeferred();

    mockedInvoke.mockReset();
    mockedInvoke
      .mockImplementationOnce((command: string) => {
        if (command === 'get_sorted_view') return firstRequest.promise;
        return Promise.resolve(null);
      })
      .mockImplementationOnce((command: string) => {
        if (command === 'get_sorted_view') return secondRequest.promise;
        return Promise.resolve(null);
      });

    const { result } = renderHook(() => useRemoteSort(sortOptions({ results, resultsVersion: 1 })));

    act(() => {
      result.current.handleSortToggle('filename');
    });
    act(() => {
      result.current.handleSortToggle('filename');
    });

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledTimes(2);
    });

    act(() => {
      firstRequest.resolve(toSlabIndices([2, 1, 0]));
    });
    await Promise.resolve();

    act(() => {
      secondRequest.resolve(toSlabIndices([1, 2, 0]));
    });

    await waitFor(() => {
      expect(result.current.displayedResults).toEqual(toSlabIndices([1, 2, 0]));
    });
  });

  it('withholds sorting by size, and only by size, past the folder-walk limit', async () => {
    const results = toSlabIndices([0, 1, 2]);
    const { result } = renderHook(() =>
      useRemoteSort(
        sortOptions({
          results,
          folderSizes: true,
          deepFolderSizes: true,
          formatSizeDisabledTooltip: (limit) => `walk limit ${limit}`,
        }),
      ),
    );

    act(() => {
      result.current.setDeepSortThreshold(2);
    });

    await waitFor(() => {
      expect(result.current.sizeSortDisabledTooltip).toBe('walk limit 2');
    });
    // The general limit is untouched, so every other column keeps working.
    expect(result.current.canSort).toBe(true);
    expect(result.current.sortDisabledTooltip).toBeNull();

    act(() => {
      result.current.handleSortToggle('size');
    });
    expect(result.current.sortState).toBeNull();

    act(() => {
      result.current.handleSortToggle('mtime');
    });
    expect(result.current.sortState).toEqual({ key: 'mtime', direction: 'asc' });
  });

  it('queues the disk walks once and re-orders on their progress without restarting them', async () => {
    const results = toSlabIndices([0, 1, 2]);
    const { result } = renderHook(() =>
      useRemoteSort(sortOptions({ results, folderSizes: true, deepFolderSizes: true })),
    );

    act(() => {
      result.current.handleSortToggle('size');
    });

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('get_sorted_view', {
        results,
        sort: { key: 'size', direction: 'asc' },
        folderSizes: true,
        deepFolderSizes: true,
      });
    });
    expect(result.current.deepSortOwnsWalks).toBe(true);

    mockedInvoke.mockClear();
    act(() => {
      result.current.refreshSort();
    });

    // A refresh reads the totals already reported; asking for the walks again would open a newer
    // generation and cancel the ones still running.
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('get_sorted_view', {
        results,
        sort: { key: 'size', direction: 'asc' },
        folderSizes: true,
        deepFolderSizes: false,
      });
    });
  });
});
