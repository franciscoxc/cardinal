import React, { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColumnKey } from '../constants';
import type { SortKey, SortState } from '../types/sort';
import { useColumnDrag } from '../hooks/useColumnDrag';
import { CONTEXT_COLUMN, type OrderedColumn } from '../hooks/useColumnOrder';

const columnMeta: Record<ColumnKey, { labelKey: string; className: string }> = {
  filename: { labelKey: 'columns.filename', className: 'filename-text' },
  path: { labelKey: 'columns.path', className: 'path-text' },
  size: { labelKey: 'columns.size', className: 'size-text' },
  modified: { labelKey: 'columns.modified', className: 'mtime-text' },
  created: { labelKey: 'columns.created', className: 'ctime-text' },
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

            const { labelKey, className } = columnMeta[column];
            const label = t(labelKey);
            const sortKey = sortableColumns[column];
            const isActive = sortState?.key === sortKey;
            const indicatorClasses = ['sort-indicator'];

            if (isActive && sortState) {
              indicatorClasses.push(
                sortState.direction === 'asc' ? 'sort-indicator--asc' : 'sort-indicator--desc',
              );
            } else {
              indicatorClasses.push('sort-indicator--neutral');
            }

            if (sortDisabled) {
              indicatorClasses.push('sort-indicator--disabled');
            } else if (isActive) {
              indicatorClasses.push('sort-indicator--active');
            }

            const title = sortDisabled ? sortDisabledTooltip || undefined : undefined;

            return (
              <span
                key={column}
                ref={registerCell(column)}
                className={cellClasses(column, className)}
                onMouseDown={onHeaderMouseDown(column)}
              >
                <button
                  type="button"
                  className="sort-button"
                  onClick={() => {
                    if (consumeClickAfterDrag()) {
                      return;
                    }
                    onSortToggle(sortKey);
                  }}
                  disabled={sortDisabled}
                  aria-pressed={isActive && !sortDisabled}
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
