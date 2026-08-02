import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { OrderedColumn } from './useColumnOrder';

// Below this the gesture is a click on the sort button, not a drag.
const DRAG_THRESHOLD_PX = 4;

type DragState = { column: OrderedColumn; startX: number; moved: boolean };

/**
 * Column reordering on pointer events rather than HTML5 drag-and-drop.
 *
 * ponytail-keep: the `draggable` attribute is not an option here. Tauri's webview claims
 * drag-and-drop natively so the page can receive dropped files, and that swallows dragover/drop:
 * the header showed a translucent copy of the title, the cursor stayed on "copy", and nothing ever
 * landed. Pointer events also give the cursor and the live shuffle that DnD could not.
 */
export function useColumnDrag(onColumnMove: (from: OrderedColumn, to: OrderedColumn) => void) {
  const [draggingColumn, setDraggingColumn] = useState<OrderedColumn | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const cellsRef = useRef(new Map<OrderedColumn, HTMLElement>());
  // A drag ends with a mouseup over the header, which the browser then reports as a click on the
  // sort button. Without this, letting go of a column also re-sorts the list.
  const suppressClickRef = useRef(false);

  const registerCell = useCallback(
    (column: OrderedColumn) => (node: HTMLElement | null) => {
      if (node) {
        cellsRef.current.set(column, node);
      } else {
        cellsRef.current.delete(column);
      }
    },
    [],
  );

  const onHeaderMouseDown = useCallback(
    (column: OrderedColumn) => (event: ReactMouseEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }
      dragRef.current = { column, startX: event.clientX, moved: false };
    },
    [],
  );

  const consumeClickAfterDrag = useCallback(() => {
    const suppressed = suppressClickRef.current;
    suppressClickRef.current = false;
    return suppressed;
  }, []);

  useEffect(() => {
    const columnAt = (clientX: number): OrderedColumn | null => {
      for (const [column, node] of cellsRef.current) {
        const rect = node.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right) {
          return column;
        }
      }
      return null;
    };

    const handleMove = (event: MouseEvent) => {
      const state = dragRef.current;
      if (!state) {
        return;
      }
      if (!state.moved) {
        if (Math.abs(event.clientX - state.startX) < DRAG_THRESHOLD_PX) {
          return;
        }
        state.moved = true;
        setDraggingColumn(state.column);
      }

      const over = columnAt(event.clientX);
      if (over && over !== state.column) {
        // Reorder as the pointer crosses each column, so the header shows the result while the
        // gesture is still happening rather than jumping at the end.
        onColumnMove(state.column, over);
      }
    };

    const finish = () => {
      const state = dragRef.current;
      dragRef.current = null;
      if (state?.moved) {
        suppressClickRef.current = true;
      }
      setDraggingColumn(null);
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        finish();
      }
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', finish);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', finish);
      window.removeEventListener('keydown', handleKey);
    };
  }, [onColumnMove]);

  return { draggingColumn, registerCell, onHeaderMouseDown, consumeClickAfterDrag };
}
