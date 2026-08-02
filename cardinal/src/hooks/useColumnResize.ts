import { useState, useCallback, useEffect } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  calculateInitialColWidths,
  MAX_COL_WIDTH,
  MIN_COL_WIDTH,
  CONTAINER_PADDING,
  SCROLLBAR_WIDTH,
} from '../constants';
import type { ColumnKey } from '../constants';
import { startColumnResizeDrag } from './resizeDrag';

type ColumnWidths = Record<ColumnKey, number>;

// Column layout has two intentionally different modes:
//
// - autoFilename:
//   Finder-style layout. The non-filename columns keep their current widths, and
//   filename is derived from the remaining viewport width:
//     filename = max(MIN_COL_WIDTH, availableWidth - fixedColumnsWidth)
//   This keeps the full table aligned to the window while the filename column
//   absorbs horizontal window resizes. If the fixed columns alone cannot fit,
//   filename stops at MIN_COL_WIDTH and horizontal overflow is expected.
//
// - manual:
//   User-controlled layout. Dragging any column switches to this mode, and every
//   column width becomes independent. The total column width may be smaller than,
//   equal to, or larger than the viewport. Window resizes do not change the
//   user's chosen widths unless the window is resized back near the current
//   total column width, which is treated as an intentional return to the
//   Finder-style fitted layout.
type ColumnLayoutMode = 'autoFilename' | 'manual';

type ColumnResizeState = {
  mode: ColumnLayoutMode;
  widths: ColumnWidths;
};

// Window resize events and CSS/grid math do not always land on exact integer
// equality, so use a small snap band when deciding that a manual layout has been
// resized back to "fits the viewport" and can return to autoFilename mode.
const AUTO_SNAP_THRESHOLD = 5;

const getAvailableWidth = (windowWidth: number) =>
  windowWidth - CONTAINER_PADDING - SCROLLBAR_WIDTH;

const getFixedWidth = (widths: ColumnWidths) =>
  widths.path + widths.size + widths.modified + widths.created;

const getTotalWidth = (widths: ColumnWidths) => getFixedWidth(widths) + widths.filename;

const withAutoFilenameWidth = (widths: ColumnWidths, available: number): ColumnWidths => {
  const filename = Math.max(MIN_COL_WIDTH, available - getFixedWidth(widths));
  return widths.filename === filename ? widths : { ...widths, filename };
};

const calculateAutoColumnWidths = (windowWidth: number): ColumnWidths => {
  const widths = calculateInitialColWidths(windowWidth);
  return withAutoFilenameWidth(widths, getAvailableWidth(windowWidth));
};

// True when the ratio layout collapsed: every fixed column sits at the floor, which the ratios
// only produce for an absurdly narrow window.
const isCollapsed = (widths: ColumnWidths) =>
  widths.path === MIN_COL_WIDTH &&
  widths.size === MIN_COL_WIDTH &&
  widths.modified === MIN_COL_WIDTH &&
  widths.created === MIN_COL_WIDTH;

const resizeForWindowWidth = (prev: ColumnResizeState, available: number): ColumnResizeState => {
  // Manual mode means the user owns every column width. A window resize should
  // not disturb those widths unless the viewport is resized back near the
  // current total, which is our snap point for returning to autoFilename mode.
  if (
    prev.mode === 'manual' &&
    Math.abs(available - getTotalWidth(prev.widths)) > AUTO_SNAP_THRESHOLD
  ) {
    return prev;
  }

  // ponytail-keep: re-derive from the ratios, do not just stretch filename. The first render can
  // happen before the window has its real size — Tauri restores window state after creating it —
  // and then every ratio floors at MIN_COL_WIDTH. Since this handler only ever recomputed
  // filename, the other four stayed 30px wide for the rest of the session: unreadable, and far
  // too small a target to drag or resize.
  if (prev.mode === 'autoFilename' && isCollapsed(prev.widths) && available > MIN_COL_WIDTH * 10) {
    return { mode: 'autoFilename', widths: calculateAutoColumnWidths(window.innerWidth) };
  }

  const widths = withAutoFilenameWidth(prev.widths, available);
  // Avoid rerendering on resize events that do not actually change either the
  // layout mode or the derived filename width.
  if (prev.mode === 'autoFilename' && widths === prev.widths) {
    return prev;
  }

  return { mode: 'autoFilename', widths };
};

const resizeColumnManually = (
  prev: ColumnResizeState,
  key: ColumnKey,
  newWidth: number,
): ColumnResizeState => {
  // Dragging any column is a user override, so even a no-op width update should
  // leave autoFilename mode and enter manual mode. Once already manual, preserve
  // the previous state object when the width is unchanged; resizeDrag can emit
  // repeated values during rAF coalescing, and returning prev avoids redundant
  // React work.
  const widths = prev.widths[key] === newWidth ? prev.widths : { ...prev.widths, [key]: newWidth };
  if (prev.mode === 'manual' && widths === prev.widths) {
    return prev;
  }

  return { mode: 'manual', widths };
};

export function useColumnResize() {
  const [state, setState] = useState<ColumnResizeState>(() => ({
    mode: 'autoFilename',
    widths: calculateAutoColumnWidths(window.innerWidth),
  }));

  // In autoFilename mode, every window resize re-derives filename from the
  // current fixed columns. In manual mode, preserve the user's independent
  // column widths until the viewport width is within AUTO_SNAP_THRESHOLD of the
  // current column total, then switch back to autoFilename.
  useEffect(() => {
    const handleResize = () => {
      setState((prev) => {
        const available = getAvailableWidth(window.innerWidth);
        return resizeForWindowWidth(prev, available);
      });
    };
    window.addEventListener('resize', handleResize);
    // The window may never fire a resize if it was created at its final size after the first
    // paint, so repair the collapsed layout once on the next frame too.
    const frame = requestAnimationFrame(handleResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const clampWidth = useCallback(
    (value: number) => Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, value)),
    [],
  );

  const onResizeStart = useCallback(
    (key: ColumnKey) => (e: ReactMouseEvent<HTMLSpanElement>) => {
      const startWidth = state.widths[key];
      startColumnResizeDrag({
        event: e,
        startWidth,
        clampWidth,
        applyWidth: (newWidth) => {
          setState((prev) => resizeColumnManually(prev, key, newWidth));
        },
      });
    },
    [clampWidth, state.widths],
  );

  const autoFitColumns = useCallback(() => {
    setState({
      mode: 'autoFilename',
      widths: calculateAutoColumnWidths(window.innerWidth),
    });
  }, []);

  return {
    colWidths: state.widths,
    onResizeStart,
    autoFitColumns,
  };
}
