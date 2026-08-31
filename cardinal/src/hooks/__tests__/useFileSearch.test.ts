import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { SlabIndex } from '../../types/slab';
import { useFileSearch } from '../useFileSearch';
import { SearchStatusCode } from '../../types/ipc';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

const searchResponse = (results: SlabIndex[] = []) => ({
  results,
  highlights: [],
  statusCode: SearchStatusCode.OK,
});

const mockSearchSuccess = (results: SlabIndex[] = []) => {
  mockedInvoke.mockImplementation((command: string) => {
    if (command === 'get_app_status') {
      return Promise.resolve('Ready');
    }
    if (command === 'search') {
      return Promise.resolve(searchResponse(results));
    }
    return Promise.resolve(null);
  });
};

const mockSearchCancelled = () => {
  mockedInvoke.mockImplementation((command: string) => {
    if (command === 'get_app_status') {
      return Promise.resolve('Ready');
    }
    if (command === 'search') {
      return Promise.resolve({
        results: [],
        highlights: [],
        statusCode: SearchStatusCode.CANCELLED,
      });
    }
    return Promise.resolve(null);
  });
};

const renderReadySearchHook = async () => {
  const rendered = renderHook(() => useFileSearch());
  await waitFor(() => expect(rendered.result.current.state.initialFetchCompleted).toBe(true));
  return rendered;
};

/// Startup no longer searches for the empty query, so a test that needs results has to ask for
/// something. `informe` is arbitrary; what matters is that it is not empty.
const renderWithResults = async () => {
  const rendered = await renderReadySearchHook();
  await act(async () => {
    rendered.result.current.queueSearch('informe', { immediate: true });
  });
  await waitFor(() => expect(rendered.result.current.state.currentQuery).toBe('informe'));
  return rendered;
};

describe('useFileSearch', () => {
  beforeEach(() => {
    // Preferences live in storage and the search hook reads them at call time, so a test that
    // changes one leaks into every test after it unless this clears.
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('never asks the backend for an empty query, at startup or after clearing the field', async () => {
    mockSearchSuccess([1, 2, 3] as SlabIndex[]);
    const { result } = await renderReadySearchHook();

    // Startup: the whole index would come back, and nobody reads a list of the whole disk.
    expect(mockedInvoke).not.toHaveBeenCalledWith('search', expect.anything());
    expect(result.current.state.results).toEqual([]);
    expect(result.current.state.initialFetchCompleted).toBe(true);

    await act(async () => {
      result.current.queueSearch('informe', { immediate: true });
    });
    await waitFor(() => expect(result.current.state.results).toEqual([1, 2, 3]));

    mockedInvoke.mockClear();
    await act(async () => {
      result.current.queueSearch('', { immediate: true });
    });

    // Clearing the field is the same request, and used to cost the same three seconds.
    await waitFor(() => expect(result.current.state.results).toEqual([]));
    expect(mockedInvoke).not.toHaveBeenCalledWith('search', expect.anything());
  });

  it('asks the engine to group folders, and honours the preference when it is off', async () => {
    mockSearchSuccess([1, 2, 3] as SlabIndex[]);
    const { result } = await renderWithResults();

    // On by default, and grouped by the engine rather than by a second call: the results are
    // already crossing to the webview, so re-ordering them there would send the list back twice.
    expect(mockedInvoke).toHaveBeenLastCalledWith(
      'search',
      expect.objectContaining({ foldersFirst: true }),
    );

    window.localStorage.setItem('cardinal.preferences.foldersFirst', 'false');
    await act(async () => {
      result.current.queueSearch('otra cosa', { immediate: true });
    });

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenLastCalledWith(
        'search',
        expect.objectContaining({ foldersFirst: false }),
      ),
    );
  });

  it('reuses backend results array without copying', async () => {
    const backendResults = [1, 2, 3] as SlabIndex[];
    mockSearchSuccess(backendResults);
    const { result } = await renderWithResults();

    expect(result.current.state.results).toBe(backendResults);
    expect(result.current.state.resultCount).toBe(backendResults.length);
  });

  it('ignores results when backend returns CANCELLED status', async () => {
    const initialResults = [1, 2, 3] as SlabIndex[];
    mockSearchSuccess(initialResults);
    const { result } = await renderWithResults();
    expect(result.current.state.results).toBe(initialResults);

    mockSearchCancelled();

    act(() => {
      result.current.queueSearch('new query', { immediate: true });
    });

    // Cancelled results should not overwrite state, and loading should settle.
    await waitFor(() => {
      expect(result.current.state.results).toBe(initialResults);
      expect(result.current.state.currentQuery).toBe('informe'); // Query doesn't update on cancelled search
      expect(result.current.state.showLoadingUI).toBe(false);
      expect(result.current.state.initialFetchCompleted).toBe(true);
    });
  });

  it('does not send directory scope while the scope input is inactive', async () => {
    mockSearchSuccess();
    const { result } = await renderWithResults();
    mockedInvoke.mockClear();

    act(() => {
      result.current.queueDirectorySearch('Projects', { immediate: true });
    });

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('search', {
        query: 'informe',
        directoryQuery: null,
        options: {
          caseInsensitive: true,
        },
        foldersFirst: true,
      });
    });
  });

  it('re-runs search when directory scope is toggled and controls the directory payload', async () => {
    mockSearchSuccess();
    const { result } = await renderWithResults();

    act(() => {
      result.current.queueDirectorySearch('Projects', { immediate: true });
    });
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenLastCalledWith('search', {
        query: 'informe',
        directoryQuery: null,
        options: {
          caseInsensitive: true,
        },
        foldersFirst: true,
      });
    });

    mockedInvoke.mockClear();
    act(() => {
      result.current.queueDirectoryScopeOpen(true);
    });
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenLastCalledWith('search', {
        query: 'informe',
        directoryQuery: 'Projects',
        options: {
          caseInsensitive: true,
        },
        foldersFirst: true,
      });
      expect(result.current.state.currentDirectoryQuery).toBe('Projects');
    });

    mockedInvoke.mockClear();
    act(() => {
      result.current.queueDirectoryScopeOpen(false);
    });
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenLastCalledWith('search', {
        query: 'informe',
        directoryQuery: null,
        options: {
          caseInsensitive: true,
        },
        foldersFirst: true,
      });
      expect(result.current.state.currentDirectoryQuery).toBe('');
    });
  });

  it('starts folded, even after the scope was left open in a previous session', async () => {
    window.localStorage.setItem('cardinal.search.directoryScopeOpen', 'true');
    mockSearchSuccess();
    const { result } = await renderReadySearchHook();

    // A scope restored from last time narrows every search while being easy to miss.
    expect(result.current.searchParams.directoryScopeOpen).toBe(false);
  });

  it('passes whitespace directory scope through when the scope is active', async () => {
    mockSearchSuccess();
    const { result } = await renderReadySearchHook();

    act(() => {
      result.current.queueDirectorySearch('   ', { immediate: true });
    });
    act(() => {
      result.current.queueDirectoryScopeOpen(true);
    });

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenLastCalledWith('search', {
        query: null,
        directoryQuery: '   ',
        options: {
          caseInsensitive: true,
        },
        foldersFirst: true,
      });
      expect(result.current.state.currentDirectoryQuery).toBe('   ');
    });
  });

  it('passes whitespace query through to search', async () => {
    mockSearchSuccess();
    const { result } = await renderReadySearchHook();
    mockedInvoke.mockClear();

    act(() => {
      result.current.queueSearch('   ', { immediate: true });
    });

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenLastCalledWith('search', {
        query: '   ',
        directoryQuery: null,
        options: {
          caseInsensitive: true,
        },
        foldersFirst: true,
      });
      expect(result.current.state.currentQuery).toBe('   ');
    });
  });
});
