import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { subscribeFolderSizeUpdate, subscribeIconUpdate } from '../../runtime/tauriEventRuntime';
import type { SlabIndex } from '../../types/slab';
import { useDataLoader } from '../useDataLoader';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../../runtime/tauriEventRuntime', () => ({
  subscribeIconUpdate: vi.fn(),
  subscribeFolderSizeUpdate: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedSubscribeIconUpdate = vi.mocked(subscribeIconUpdate);
const mockedSubscribeFolderSize = vi.mocked(subscribeFolderSizeUpdate);
type HookProps = { results: SlabIndex[]; version: number };

const buildNodeInfo = (slabIndex: SlabIndex) => ({
  path: `/tmp/file-${slabIndex}`,
  icon: null,
  metadata: null,
  size: null,
  mtime: null,
  ctime: null,
});
type BuiltNodeInfo = ReturnType<typeof buildNodeInfo>;

// `type` 1 is a directory: the only kind of row the loader asks a total for.
const buildFolderInfo = (slabIndex: SlabIndex) => ({
  ...buildNodeInfo(slabIndex),
  path: `/tmp/folder-${slabIndex}`,
  metadata: { type: 1, size: 96, mtime: 0, ctime: 0 },
});

type FolderSizes = {
  sizes: ({ bytes: number; incomplete: boolean } | null)[];
  interrupted: boolean;
};

/// Answers both loader commands: rows for everything, as folders where `folders` says so, and
/// whatever `sizes` decides for the totals asked for afterwards.
const answerWith = (
  folders: SlabIndex[],
  sizes: (asked: SlabIndex[]) => FolderSizes | Promise<FolderSizes>,
) => {
  mockedInvoke.mockImplementation((command: string, payload?: unknown) => {
    const asked = (payload as { results: SlabIndex[] } | undefined)?.results ?? [];
    if (command === 'get_nodes_info') {
      return Promise.resolve(
        asked.map((slabIndex) =>
          folders.includes(slabIndex) ? buildFolderInfo(slabIndex) : buildNodeInfo(slabIndex),
        ),
      );
    }
    if (command === 'get_folder_sizes') {
      return Promise.resolve(sizes(asked));
    }
    return Promise.resolve(null);
  });
};

const sizeCalls = () =>
  mockedInvoke.mock.calls.filter(([command]) => command === 'get_folder_sizes');

const renderDataLoader = (initialProps: HookProps) =>
  renderHook(({ results, version }: HookProps) => useDataLoader(results, version), {
    initialProps,
  });

const renderDataLoaderWithContent = (
  initialProps: HookProps & { contentTerms: string[]; caseInsensitive: boolean },
) =>
  renderHook(
    ({ results, version, contentTerms, caseInsensitive }) =>
      useDataLoader(results, version, contentTerms, caseInsensitive),
    {
      initialProps,
    },
  );

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('useDataLoader', () => {
  const iconUpdateUnlisten = vi.fn();

  beforeEach(() => {
    mockedSubscribeIconUpdate.mockImplementation(() => iconUpdateUnlisten);
    mockedInvoke.mockImplementation((command: string, payload?: unknown) => {
      if (command !== 'get_nodes_info') {
        return Promise.resolve(null);
      }

      const slabIndices = (payload as { results: SlabIndex[] }).results;
      return Promise.resolve(slabIndices.map((slabIndex) => buildNodeInfo(slabIndex)));
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not clear cache when only results reference changes', async () => {
    const slab11 = 11 as SlabIndex;
    const slab22 = 22 as SlabIndex;
    const first = [slab11, slab22];
    const { result, rerender } = renderDataLoader({ results: first, version: 1 });

    await act(async () => {
      await result.current.ensureRangeLoaded(0, 1);
    });

    await waitFor(() => {
      expect(result.current.cache.get(slab11)?.path).toBe('/tmp/file-11');
      expect(result.current.cache.get(slab22)?.path).toBe('/tmp/file-22');
    });
    expect(mockedInvoke).toHaveBeenCalledTimes(1);

    rerender({ results: [...first], version: 1 });

    await act(async () => {
      await result.current.ensureRangeLoaded(0, 1);
    });

    expect(result.current.cache.get(slab11)?.path).toBe('/tmp/file-11');
    expect(result.current.cache.get(slab22)?.path).toBe('/tmp/file-22');
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it('resets cache when results version changes', async () => {
    const first = [33 as SlabIndex, 44 as SlabIndex];
    const { result, rerender } = renderDataLoader({ results: first, version: 1 });

    await act(async () => {
      await result.current.ensureRangeLoaded(0, 1);
    });

    await waitFor(() => expect(result.current.cache.size).toBe(2));
    expect(mockedInvoke).toHaveBeenCalledTimes(1);

    rerender({ results: first, version: 2 });

    await waitFor(() => expect(result.current.cache.size).toBe(0));

    await act(async () => {
      await result.current.ensureRangeLoaded(0, 1);
    });

    await waitFor(() => expect(result.current.cache.size).toBe(2));
    expect(mockedInvoke).toHaveBeenCalledTimes(2);
  });

  it('ignores stale node info responses after the results version changes', async () => {
    const slab11 = 11 as SlabIndex;
    const slab22 = 22 as SlabIndex;
    const deferred = createDeferred<BuiltNodeInfo[]>();
    let getNodesInfoCalls = 0;

    mockedInvoke.mockImplementation((command: string, payload?: unknown) => {
      if (command !== 'get_nodes_info') {
        return Promise.resolve(null);
      }

      getNodesInfoCalls += 1;
      const slabIndices = (payload as { results: SlabIndex[] }).results;
      if (getNodesInfoCalls === 1) {
        return deferred.promise;
      }
      return Promise.resolve(slabIndices.map((slabIndex) => buildNodeInfo(slabIndex)));
    });

    const { result, rerender } = renderDataLoader({ results: [slab11], version: 1 });

    act(() => {
      void result.current.ensureRangeLoaded(0, 0);
    });

    rerender({ results: [slab22], version: 2 });

    await act(async () => {
      await result.current.ensureRangeLoaded(0, 0);
    });

    await waitFor(() => {
      expect(result.current.cache.get(slab22)?.path).toBe('/tmp/file-22');
    });

    await act(async () => {
      deferred.resolve([buildNodeInfo(slab11)]);
      await deferred.promise;
    });

    expect(result.current.cache.get(slab11)).toBeUndefined();
    expect(result.current.cache.get(slab22)?.path).toBe('/tmp/file-22');
  });

  it('cleans up icon update subscription on unmount', async () => {
    const { unmount } = renderDataLoader({ results: [11 as SlabIndex], version: 1 });
    unmount();

    expect(iconUpdateUnlisten).toHaveBeenCalled();
  });

  it('passes content snippet options to node info requests', async () => {
    const { result } = renderDataLoaderWithContent({
      results: [11 as SlabIndex],
      version: 1,
      contentTerms: ['needle'],
      caseInsensitive: true,
    });

    await act(async () => {
      await result.current.ensureRangeLoaded(0, 0);
    });

    expect(mockedInvoke).toHaveBeenCalledWith('get_nodes_info', {
      results: [11],
      contentTerms: ['needle'],
      caseInsensitive: true,
    });
  });

  it('asks what folders hold only when the caller wants it, and only for the folders', async () => {
    const file = 11 as SlabIndex;
    const folder = 22 as SlabIndex;
    answerWith([folder], (asked) => ({
      sizes: asked.map(() => ({ bytes: 100, incomplete: false })),
      interrupted: false,
    }));

    // Walking a subtree per row is not free, so it follows the Size column's visibility rather
    // than being always on.
    const { result, rerender } = renderHook(
      ({ folderSizes }: { folderSizes: boolean }) =>
        useDataLoader([file, folder], 1, [], false, folderSizes),
      { initialProps: { folderSizes: false } },
    );
    await act(async () => {
      await result.current.ensureRangeLoaded(0, 1);
    });
    expect(sizeCalls()).toHaveLength(0);

    rerender({ folderSizes: true });
    await act(async () => {
      await result.current.ensureRangeLoaded(0, 1);
    });

    await waitFor(() => expect(result.current.cache.get(folder)?.folderSize).toBe(100));
    expect(sizeCalls()).toEqual([
      ['get_folder_sizes', { results: [folder], deepFolderSizes: false }],
    ]);
    expect(result.current.cache.get(file)?.folderSize).toBeUndefined();
  });

  it('shows the rows without waiting for what the folders in them hold', async () => {
    const folder = 22 as SlabIndex;
    const sizes = createDeferred<FolderSizes>();
    answerWith([folder], () => sizes.promise);

    const { result } = renderHook(() => useDataLoader([folder], 1, [], false, true));
    await act(async () => {
      await result.current.ensureRangeLoaded(0, 0);
    });

    // The first sum of a large folder takes as long as reading every file under it. With the
    // total travelling inside the row, the whole list stayed blank for that long.
    expect(result.current.cache.get(folder)?.path).toBe('/tmp/folder-22');
    expect(result.current.cache.get(folder)?.folderSize).toBeUndefined();

    await act(async () => {
      sizes.resolve({ sizes: [{ bytes: 100, incomplete: true }], interrupted: false });
      await sizes.promise;
    });
    expect(result.current.cache.get(folder)?.folderSize).toBe(100);
    expect(result.current.cache.get(folder)?.folderSizeIncomplete).toBe(true);
  });

  it('asks again for the totals that scrolling interrupted, and only for those', async () => {
    const reached = 22 as SlabIndex;
    const cutOff = 33 as SlabIndex;
    let round = 0;
    answerWith([reached, cutOff], (asked) => {
      round += 1;
      // Asking for new rows takes the loop back from the sums still running. The folders it did
      // not get to come back empty-handed and say so.
      return round === 1
        ? { sizes: [{ bytes: 5, incomplete: false }, null], interrupted: true }
        : { sizes: asked.map(() => ({ bytes: 7, incomplete: false })), interrupted: false };
    });

    const { result } = renderHook(() => useDataLoader([reached, cutOff], 1, [], false, true));
    await act(async () => {
      await result.current.ensureRangeLoaded(0, 1);
    });

    await waitFor(() => expect(result.current.cache.get(cutOff)?.folderSize).toBe(7));
    expect(result.current.cache.get(reached)?.folderSize).toBe(5);
    expect(sizeCalls().map(([, payload]) => (payload as { results: number[] }).results)).toEqual([
      [reached, cutOff],
      [cutOff],
    ]);
  });

  it('does not keep asking for a folder that has no total to give', async () => {
    const folder = 22 as SlabIndex;
    answerWith([folder], () => ({ sizes: [null], interrupted: false }));

    const { result } = renderHook(() => useDataLoader([folder], 1, [], false, true));
    await act(async () => {
      await result.current.ensureRangeLoaded(0, 0);
    });
    await act(async () => {});

    // Nothing interrupted this answer, so the missing total is the answer.
    expect(sizeCalls()).toHaveLength(1);
    expect(result.current.cache.get(folder)?.folderSize).toBeUndefined();
  });

  it('drops totals that arrive for a result set that is no longer shown', async () => {
    const folder = 22 as SlabIndex;
    const sizes = createDeferred<FolderSizes>();
    answerWith([folder], () => sizes.promise);

    const { result, rerender } = renderHook(
      ({ version }: { version: number }) => useDataLoader([folder], version, [], false, true),
      { initialProps: { version: 1 } },
    );
    await act(async () => {
      await result.current.ensureRangeLoaded(0, 0);
    });

    // Slab indices are reused across searches: the same number can be another file by now.
    rerender({ version: 2 });
    await act(async () => {
      sizes.resolve({ sizes: [{ bytes: 100, incomplete: false }], interrupted: true });
      await sizes.promise;
    });

    expect(result.current.cache.get(folder)).toBeUndefined();
    expect(sizeCalls()).toHaveLength(1);
  });

  it('grows a folder total as the walk reports, and drops the marker when it finishes', async () => {
    const folder = 11 as SlabIndex;
    let emitProgress:
      | ((updates: { slabIndex: number; bytes: number; done: boolean }[]) => void)
      | null = null;
    mockedSubscribeFolderSize.mockImplementation((listener) => {
      emitProgress = listener as typeof emitProgress;
      return () => {};
    });
    answerWith([folder], () => ({
      sizes: [{ bytes: 100, incomplete: true }],
      interrupted: false,
    }));

    const { result } = renderHook(() => useDataLoader([folder], 1, [], false, true));
    await act(async () => {
      await result.current.ensureRangeLoaded(0, 0);
    });
    await waitFor(() => expect(result.current.cache.get(folder)?.folderSize).toBe(100));

    act(() => emitProgress?.([{ slabIndex: 11, bytes: 900, done: false }]));
    expect(result.current.cache.get(folder)?.folderSize).toBe(900);
    expect(result.current.cache.get(folder)?.folderSizeIncomplete).toBe(true);

    act(() => emitProgress?.([{ slabIndex: 11, bytes: 1500, done: true }]));
    expect(result.current.cache.get(folder)?.folderSize).toBe(1500);
    expect(result.current.cache.get(folder)?.folderSizeIncomplete).toBe(false);

    // A straggler from a cancelled walk would otherwise make the number jump backwards.
    act(() => emitProgress?.([{ slabIndex: 11, bytes: 300, done: true }]));
    expect(result.current.cache.get(folder)?.folderSize).toBe(1500);
  });

  it('keeps what the disk walk reported when the indexed sum arrives after it', async () => {
    const folder = 22 as SlabIndex;
    let emitProgress:
      | ((updates: { slabIndex: number; bytes: number; done: boolean }[]) => void)
      | null = null;
    mockedSubscribeFolderSize.mockImplementation((listener) => {
      emitProgress = listener as typeof emitProgress;
      return () => {};
    });
    const sizes = createDeferred<FolderSizes>();
    answerWith([folder], () => sizes.promise);

    const { result } = renderHook(() => useDataLoader([folder], 1, [], false, true, true));
    await act(async () => {
      await result.current.ensureRangeLoaded(0, 0);
    });

    // The walk is queued while the same request is still adding up the folders after this one,
    // so a short walk can finish and report before that request answers.
    act(() => emitProgress?.([{ slabIndex: 22, bytes: 900, done: true }]));
    await act(async () => {
      sizes.resolve({ sizes: [{ bytes: 100, incomplete: true }], interrupted: false });
      await sizes.promise;
    });

    // The indexed sum is where the walk started from. Written over the result, the number
    // dropped and the "+" came back for good, because a finished walk does not report again.
    expect(result.current.cache.get(folder)?.folderSize).toBe(900);
    expect(result.current.cache.get(folder)?.folderSizeIncomplete).toBe(false);
  });

  it('refetches rows when the requested columns change, not only when the search does', async () => {
    const folder = 11 as SlabIndex;
    answerWith([folder], () => ({
      sizes: [{ bytes: 100, incomplete: false }],
      interrupted: false,
    }));
    const { result, rerender } = renderHook(
      ({ folderSizes }: { folderSizes: boolean }) =>
        useDataLoader([folder], 1, [], false, folderSizes),
      { initialProps: { folderSizes: false } },
    );

    await act(async () => {
      await result.current.ensureRangeLoaded(0, 0);
    });
    expect(mockedInvoke).toHaveBeenCalledTimes(1);

    // Turning the Size column back on used to leave every cached row without its total: the rows
    // were already in the cache, so nothing asked for them again until the next search.
    mockedInvoke.mockClear();
    rerender({ folderSizes: true });
    await act(async () => {
      await result.current.ensureRangeLoaded(0, 0);
    });

    await waitFor(() => expect(result.current.cache.get(folder)?.folderSize).toBe(100));
    expect(mockedInvoke).toHaveBeenCalledWith('get_nodes_info', expect.anything());
  });
});
