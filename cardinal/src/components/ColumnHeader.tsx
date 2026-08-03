import React, { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColumnKey } from '../constants';
import type { SortKey, SortState } from '../types/sort';
import { useColumnDrag } from '../hooks/useColumnDrag';
import { COLUMN_LABEL_KEYS, CONTEXT_COLUMN, type OrderedColumn } from '../hooks/useColumnOrder';

const columnClasses: Record<ColumnKey, string> = {
  filename: 'filename-text',
  path: 'path-text',
  size: 'size-text',
  modified: 'mtime-text',
  created: 'ctime-text',
};

const sortableColumns: Record<ColumnKey, SortKey> = {
  filename: 'filename',
  path: 'fullPath',
  size: 'size',
  modified: 'mtime',
  created: 'ctime',
};

type ColumnHeaderProps = {
  onResizeStart: (key: ColumnKey) => (event: React.MouseEvent<HTMLSpanElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  sortState: SortState | null;
  onSortToggle: (sortKey: SortKey) => void;
  sortDisabled: boolean;
  sortDisabledTooltip: string | null;
  /** Set when only the Size column cannot be sorted, because the disk walk has its own limit. */
  sizeSortDisabledTooltip: string | null;
  showContentContext: boolean;
  columnOrder: readonly OrderedColumn[];
  onColumnMove: (dragged: OrderedColumn, target: OrderedColumn) => void;
  columnsTemplate: string;
};

// Column widths are applied via CSS vars on container; no need to pass colWidths prop.
export const ColumnHeader = forwardRef<HTMLDivElement, ColumnHeaderProps>(
  (
    {
      onResizeStart,
      onContextMenu,
      sortState,
      onSortToggle,
      sortDisabled,
      sortDisabledTooltip,
      sizeSortDisabledTooltip,
      showContentContext,
      columnOrder,
      onColumnMove,
      columnsTemplate,
    },
    ref,
  ) => {
    const { t } = useTranslation();
    const { draggingColumn, registerCell, onHeaderMouseDown, consumeClickAfterDrag } =
      useColumnDrag(onColumnMove);

    const cellClasses = (column: OrderedColumn, base: string) =>
      `${base} header header-cell${draggingColumn === column ? ' header-cell--dragging' : ''}`;

    return (
      <div ref={ref} className="header-row-container">
        <div
          className="header-row columns"
          style={{ gridTemplateColumns: columnsTemplate }}
          onContextMenu={onContextMenu}
        >
          {columnOrder.map((column) => {
            if (column === CONTEXT_COLUMN) {
              if (!showContentContext) {
                return null;
              }
              // No sort key and no resizer: the snippet column's width follows the window.
              return (
                <span
                  key={column}
                  ref={registerCell(column)}
                  className={cellClasses(column, 'context-text')}
                  onMouseDown={onHeaderMouseDown(column)}
                >
                  {t('columns.context')}
                </span>
              );
            }

            const className = columnClasses[column];
            const label = t(COLUMN_LABEL_KEYS[column]);
            const sortKey = sortableColumns[column];
            const isActive = sortState?.key === sortKey;
            const indicatorClasses = ['sort-indicator'];
            // Size can be the only column that cannot be sorted: ordering by it has to finish
            // walking every folder first, which the other columns never wait for.
            const columnSortDisabled =
              sortDisabled || (column === 'size' && sizeSortDisabledTooltip !== null);

            if (isActive && sortState) {
              indicatorClasses.push(
                sortState.direction === 'asc' ? 'sort-indicator--asc' : 'sort-indicator--desc',
              );
            } else {
              indicatorClasses.push('sort-indicator--neutral');
            }

            if (columnSortDisabled) {
              indicatorClasses.push('sort-indicator--disabled');
            } else if (isActive) {
              indicatorClasses.push('sort-indicator--active');
            }

            const title = sortDisabled
              ? sortDisabledTooltip || undefined
              : columnSortDisabled
                ? sizeSortDisabledTooltip || undefined
                : undefined;

            return (
              <span
                key={column}
                ref={registerCell(column)}
                className={cellClasses(column, className)}
                onMouseDown={onHeaderMouseDown(column)}
              >
                <button
                  type="button"
                  className={`sort-button${columnSortDisabled ? ' sort-button--disabled' : ''}`}
                  onClick={() => {
                    if (consumeClickAfterDrag() || columnSortDisabled) {
                      return;
                    }
                    onSortToggle(sortKey);
                  }}
                  // ponytail-keep: aria-disabled, not the `disabled` attribute. A disabled button
                  // swallows mouse events instead of bubbling them, so above the sort limit
                  // (20k results) the press never reached the cell and columns could not be
                  // dragged either — sorting and reordering have nothing to do with each other.
                  aria-disabled={columnSortDisabled}
                  aria-pressed={isActive && !columnSortDisabled}
                  title={title}
                >
                  <span className="sort-button__label">{label}</span>
                  <span className={indicatorClasses.join(' ')} aria-hidden="true" />
                </button>
                <span
                  className="col-resizer"
                  onMouseDown={(event) => {
                    // The handle sits inside the header cell, so without this the same press
                    // starts a column drag and the resize turns into a reorder.
                    event.stopPropagation();
                    onResizeStart(column)(event);
                  }}
                />
              </span>
            );
          })}
          {/* Spacer for scrollbar width alignment */}
          <span className="header-scrollbar-spacer" />
        </div>
      </div>
    );
  },
);

ColumnHeader.displayName = 'ColumnHeader';
