import { useCallback } from 'react';
import { useStoredState } from './useStoredState';
import type { ColumnKey } from '../constants';

/** The snippet column only exists while a `content:` search is running, so it is not a ColumnKey. */
export const CONTEXT_COLUMN = 'context';
export type OrderedColumn = ColumnKey | typeof CONTEXT_COLUMN;

// Name first, then why the file matched, then where it lives.
export const DEFAULT_COLUMN_ORDER: OrderedColumn[] = [
  'filename',
  CONTEXT_COLUMN,
  'path',
  'size',
  'modified',
  'created',
];

export const COLUMN_ORDER_STORAGE_KEY = 'cardinal.columns.order';
export const COLUMN_HIDDEN_STORAGE_KEY = 'cardinal.columns.hidden';

/** The name is what identifies a row, so hiding it would leave the list unreadable. */
export const ALWAYS_VISIBLE_COLUMN: OrderedColumn = 'filename';

export const COLUMN_LABEL_KEYS: Record<OrderedColumn, string> = {
  filename: 'columns.filename',
  context: 'columns.context',
  path: 'columns.path',
  size: 'columns.size',
  modified: 'columns.modified',
  created: 'columns.created',
};

const isOrderedColumn = (value: unknown): value is OrderedColumn =>
  typeof value === 'string' && DEFAULT_COLUMN_ORDER.includes(value as OrderedColumn);

/**
 * Stored order is repaired rather than trusted: a column added in a later version would otherwise
 * never appear for anyone who had already saved an order, and a removed one would linger forever.
 */
const normalize = (value: OrderedColumn[]): OrderedColumn[] => {
  const seen = new Set<OrderedColumn>();
  const kept = value.filter(
    (column) => isOrderedColumn(column) && !seen.has(column) && seen.add(column),
  );
  return [...kept, ...DEFAULT_COLUMN_ORDER.filter((column) => !seen.has(column))];
};

/** Unknown entries are dropped, and the name column can never be hidden. */
const normalizeHidden = (value: OrderedColumn[]): OrderedColumn[] => [
  ...new Set(value.filter((c) => isOrderedColumn(c) && c !== ALWAYS_VISIBLE_COLUMN)),
];

export function useColumnOrder() {
  const [order, setOrder] = useStoredState<OrderedColumn[]>({
    key: COLUMN_ORDER_STORAGE_KEY,
    defaultValue: DEFAULT_COLUMN_ORDER,
    read: (raw) => {
      const parsed: unknown = JSON.parse(raw);
      // ponytail-keep: normalize here as well, not only in the option below. useStoredState runs
      // `normalize` on write and returns whatever it read verbatim, so an order saved by an older
      // version — or hand-edited in localStorage — reached the grid with unknown or missing
      // columns and the header stopped matching the rows.
      return Array.isArray(parsed) ? normalize(parsed as OrderedColumn[]) : null;
    },
    write: (value) => JSON.stringify(value),
    normalize,
    readErrorMessage: 'Failed to read stored column order',
    writeErrorMessage: 'Failed to persist column order',
  });

  /** Moves `dragged` so it lands where `target` currently sits. */
  const moveColumn = useCallback(
    (dragged: OrderedColumn, target: OrderedColumn) => {
      if (dragged === target) {
        return;
      }
      const next = order.filter((column) => column !== dragged);
      const at = next.indexOf(target);
      if (at === -1) {
        return;
      }
      // Dropping on a column to the right means "take its place", so insert after it.
      const insertAt = order.indexOf(dragged) < order.indexOf(target) ? at + 1 : at;
      next.splice(insertAt, 0, dragged);
      setOrder(next);
    },
    [order, setOrder],
  );

  const [hidden, setHidden] = useStoredState<OrderedColumn[]>({
    key: COLUMN_HIDDEN_STORAGE_KEY,
    defaultValue: [],
    read: (raw) => {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? normalizeHidden(parsed as OrderedColumn[]) : null;
    },
    write: (value) => JSON.stringify(value),
    normalize: normalizeHidden,
    readErrorMessage: 'Failed to read hidden columns',
    writeErrorMessage: 'Failed to persist hidden columns',
  });

  const toggleColumn = useCallback(
    (column: OrderedColumn) => {
      if (column === ALWAYS_VISIBLE_COLUMN) {
        return;
      }
      setHidden(hidden.includes(column) ? hidden.filter((c) => c !== column) : [...hidden, column]);
    },
    [hidden, setHidden],
  );

  const resetOrder = useCallback(() => {
    setOrder(DEFAULT_COLUMN_ORDER);
    setHidden([]);
  }, [setHidden, setOrder]);

  return { columnOrder: order, hiddenColumns: hidden, moveColumn, toggleColumn, resetOrder };
}
