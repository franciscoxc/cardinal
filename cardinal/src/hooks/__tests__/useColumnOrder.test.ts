import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  COLUMN_HIDDEN_STORAGE_KEY,
  COLUMN_ORDER_STORAGE_KEY,
  DEFAULT_COLUMN_ORDER,
  useColumnOrder,
} from '../useColumnOrder';

beforeEach(() => {
  window.localStorage.clear();
});

describe('useColumnOrder', () => {
  it('starts with the name first and the snippet right after it', () => {
    const { result } = renderHook(() => useColumnOrder());
    expect(result.current.columnOrder.slice(0, 2)).toEqual(['filename', 'context']);
  });

  it('moves a column to where the drop target sits, in both directions', () => {
    const { result } = renderHook(() => useColumnOrder());

    act(() => result.current.moveColumn('size', 'filename'));
    expect(result.current.columnOrder[0]).toBe('size');

    act(() => result.current.moveColumn('size', 'created'));
    expect(result.current.columnOrder[result.current.columnOrder.length - 1]).toBe('size');
  });

  it('persists the order and repairs a stored one that is missing a column', () => {
    window.localStorage.setItem(COLUMN_ORDER_STORAGE_KEY, JSON.stringify(['size', 'filename']));
    const { result } = renderHook(() => useColumnOrder());

    // Missing columns are appended rather than dropped, so a column added in a later version
    // still shows up for someone who already saved an order.
    expect(result.current.columnOrder).toHaveLength(DEFAULT_COLUMN_ORDER.length);
    expect(result.current.columnOrder.slice(0, 2)).toEqual(['size', 'filename']);
  });

  it('ignores a stored order containing junk', () => {
    window.localStorage.setItem(COLUMN_ORDER_STORAGE_KEY, JSON.stringify(['nope', 'filename']));
    const { result } = renderHook(() => useColumnOrder());
    expect(result.current.columnOrder).not.toContain('nope');
    expect(result.current.columnOrder).toHaveLength(DEFAULT_COLUMN_ORDER.length);
  });

  it('hides and shows a column, and refuses to hide the name', () => {
    const { result } = renderHook(() => useColumnOrder());

    act(() => result.current.toggleColumn('size'));
    expect(result.current.hiddenColumns).toContain('size');

    act(() => result.current.toggleColumn('size'));
    expect(result.current.hiddenColumns).not.toContain('size');

    // Without the name the list is a wall of dates and sizes, so it can never be hidden.
    act(() => result.current.toggleColumn('filename'));
    expect(result.current.hiddenColumns).not.toContain('filename');
  });

  it('repairs a stored hidden list that would leave the name out', () => {
    window.localStorage.setItem(
      COLUMN_HIDDEN_STORAGE_KEY,
      JSON.stringify(['filename', 'nope', 'size', 'size']),
    );
    const { result } = renderHook(() => useColumnOrder());

    expect(result.current.hiddenColumns).toEqual(['size']);
  });

  it('resetting brings every column back', () => {
    const { result } = renderHook(() => useColumnOrder());
    act(() => result.current.toggleColumn('path'));
    act(() => result.current.resetOrder());

    expect(result.current.hiddenColumns).toEqual([]);
    expect(result.current.columnOrder).toEqual(DEFAULT_COLUMN_ORDER);
  });
});
