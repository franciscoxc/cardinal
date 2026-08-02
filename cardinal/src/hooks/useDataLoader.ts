import { useCallback, useRef, useEffect, useLayoutEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { subscribeFolderSizeUpdate, subscribeIconUpdate } from '../runtime/tauriEventRuntime';
import type { NodeInfoResponse, SearchResultItem } from '../types/search';
import type { SlabIndex } from '../types/slab';
import type { FolderSizeUpdatePayload, IconUpdatePayload } from '../types/ipc';

export type DataLoaderCache = Map<SlabIndex, SearchResultItem>;
type IconOverrideValue = string | undefined;

const fromNodeInfo = (node: NodeInfoResponse): SearchResultItem => ({
  path: node.path,
  metadata: node.metadata ?? undefined,
  size: node.size ?? node.metadata?.size,
  mtime: node.mtime ?? node.metadata?.mtime,
  ctime: node.ctime ?? node.metadata?.ctime,
  icon: node.icon ?? undefined,
  contentContext: node.contentContext ?? undefined,
  folderSize: node.folderSize ?? undefined,
  folderSizeIncomplete: node.folderSizeIncomplete ?? undefined,
});

// Data-only loader for visible rows. It owns row metadata caching and stale-request rejection;
// VirtualList handles any temporary frozen-view rendering during result-set swaps.
export function useDataLoader(
  results: SlabIndex[],
  dataResultsVersion: number,
  contentTerms: readonly string[] = [],
  caseInsensitive = false,
  folderSizes = false,
  deepFolderSizes = false,
) {
  const loadingRef = useRef<Set<SlabIndex>>(new Set());
  // Monotonic epoch for range-load requests. A new search result-set bumps this value so
  // late `get_nodes_info` responses from the previous result-set can be ignored safely.
  const versionRef = useRef(0);
  const cacheRef = useRef<DataLoaderCache>(new Map());
  const iconOverridesRef = useRef<Map<SlabIndex, IconOverrideValue>>(new Map());
  const [cache, setCache] = useState<DataLoaderCache>(() => {
    const initial = new Map<SlabIndex, SearchResultItem>();
    cacheRef.current = initial;
    return initial;
  });
  const resultsRef = useRef<SlabIndex[]>([]);
  resultsRef.current = results;

  // What a row's contents depend on besides its index. Kept in one ref because the loader reads
  // them from an async callback, where the render's values would be stale.
  const optionsRef = useRef({ contentTerms, caseInsensitive, folderSizes, deepFolderSizes });
  optionsRef.current = { contentTerms, caseInsensitive, folderSizes, deepFolderSizes };

  // ponytail-keep: the signature has to include the options, not just the result-set version.
  // Cached rows carry whatever was asked for when they were fetched, and `ensureRangeLoaded`
  // skips anything already cached — so turning the Size column back on left every visible row
  // without its total until the next search reset the cache.
  const requestSignature = `${dataResultsVersion}|${caseInsensitive}|${folderSizes}|${deepFolderSizes}|${contentTerms.join('\u0000')}`;

  // Reset cache state whenever the backing result-set changes so slab-index reuse in the
  // backend cannot surface stale row data for a newer search result-set.
  useLayoutEffect(() => {
    versionRef.current += 1;
    loadingRef.current.clear();
    iconOverridesRef.current.clear();
    const nextCache = new Map<SlabIndex, SearchResultItem>();
    cacheRef.current = nextCache;
    setCache(nextCache);
  }, [requestSignature]);

  useEffect(() => {
    const unlistenIconUpdate = subscribeIconUpdate((updates: readonly IconUpdatePayload[]) => {
      if (updates.length === 0) {
        return;
      }

      setCache((prev) => {
        let nextCache: DataLoaderCache | null = null;

        updates.forEach((update) => {
          const slabIndex = update.slabIndex;
          const nextIcon = update.icon;
          iconOverridesRef.current.set(slabIndex, nextIcon);

          const current = prev.get(slabIndex);
          if (!current || current.icon === nextIcon) {
            return;
          }

          if (nextCache === null) {
            nextCache = new Map(prev);
          }

          nextCache.set(slabIndex, { ...current, icon: nextIcon });
        });

        if (nextCache === null) {
          return prev;
        }

        cacheRef.current = nextCache;
        return nextCache;
      });
    });
    return unlistenIconUpdate;
  }, []);

  useEffect(() => {
    const unlisten = subscribeFolderSizeUpdate((updates: readonly FolderSizeUpdatePayload[]) => {
      if (updates.length === 0) {
        return;
      }

      setCache((prev) => {
        let nextCache: DataLoaderCache | null = null;

        updates.forEach(({ slabIndex, bytes, done }) => {
          const current = prev.get(slabIndex as SlabIndex);
          // A row that scrolled away is gone from the cache; its walk was cancelled anyway.
          if (!current) {
            return;
          }
          // The walk only ever adds, so an update that would shrink the number is a straggler
          // from a previous generation and is dropped rather than shown.
          if ((current.folderSize ?? 0) > bytes) {
            return;
          }

          nextCache ??= new Map(prev);
          nextCache.set(slabIndex as SlabIndex, {
            ...current,
            folderSize: bytes,
            folderSizeIncomplete: !done,
          });
        });

        if (nextCache === null) {
          return prev;
        }

        cacheRef.current = nextCache;
        return nextCache;
      });
    });
    return unlisten;
  }, []);

  const releaseLoadingBatch = useCallback((slabIndices: readonly SlabIndex[]) => {
    slabIndices.forEach((slabIndex) => loadingRef.current.delete(slabIndex));
  }, []);

  const ensureRangeLoaded = useCallback(
    async (start: number, end: number) => {
      const list = resultsRef.current;
      const total = list.length;
      if (start < 0 || end < start || total === 0) return;
      const needLoading: SlabIndex[] = [];
      for (let i = start; i <= end && i < total; i++) {
        const slabIndex = list[i];
        // Request only cache misses in the active window.
        if (!cacheRef.current.has(slabIndex) && !loadingRef.current.has(slabIndex)) {
          needLoading.push(slabIndex);
          loadingRef.current.add(slabIndex);
        }
      }
      if (needLoading.length === 0) return;
      const versionAtRequest = versionRef.current;
      const fetched = await invoke<NodeInfoResponse[]>('get_nodes_info', {
        results: needLoading,
        ...optionsRef.current,
      });
      if (versionRef.current !== versionAtRequest) {
        // The result-set changed while this request was in flight. Drop the payload instead of
        // merging stale rows into the cache for the new query.
        releaseLoadingBatch(needLoading);
        return;
      }
      setCache((prev) => {
        if (versionRef.current !== versionAtRequest) return prev;
        let nextCache: DataLoaderCache | null = null;

        needLoading.forEach((slabIndex, idx) => {
          const fetchedItem = fetched[idx];
          loadingRef.current.delete(slabIndex);
          if (!fetchedItem) {
            return;
          }

          const normalizedItem = fromNodeInfo(fetchedItem);
          const existing = prev.get(slabIndex);
          const hasOverride = iconOverridesRef.current.has(slabIndex);
          // Preserve newer icon updates that may have arrived after the node snapshot was read.
          const preferredIcon = hasOverride
            ? iconOverridesRef.current.get(slabIndex)
            : (existing?.icon ?? normalizedItem.icon);

          const mergedItem =
            preferredIcon === normalizedItem.icon
              ? normalizedItem
              : { ...normalizedItem, icon: preferredIcon };

          if (nextCache === null) {
            nextCache = new Map(prev);
          }

          nextCache.set(slabIndex, mergedItem);
        });

        if (nextCache === null) {
          return prev;
        }

        cacheRef.current = nextCache;
        return nextCache;
      });
    },
    [releaseLoadingBatch],
  );

  return { cache, ensureRangeLoaded };
}
