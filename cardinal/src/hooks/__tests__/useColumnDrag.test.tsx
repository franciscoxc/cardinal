import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useColumnDrag } from '../useColumnDrag';
import type { OrderedColumn } from '../useColumnOrder';

// Two header cells side by side, so a drag from one lands on the other.
function Header({
  onColumnMove,
  sortDisabled = false,
}: {
  onColumnMove: (a: OrderedColumn, b: OrderedColumn) => void;
  sortDisabled?: boolean;
}) {
  const { draggingColumn, registerCell, onHeaderMouseDown, consumeClickAfterDrag } =
    useColumnDrag(onColumnMove);
  const sorted = vi.fn();

  return (
    <div>
      {(['filename', 'size'] as OrderedColumn[]).map((column, index) => (
        <span
          key={column}
          data-testid={column}
          ref={(node) => {
            if (node) {
              // jsdom gives every element a zero-sized rect; the hook hit-tests on clientX.
              node.getBoundingClientRect = () =>
                ({ left: index * 100, right: index * 100 + 100 }) as DOMRect;
            }
            registerCell(column)(node);
          }}
          className={draggingColumn === column ? 'dragging' : ''}
          onMouseDown={onHeaderMouseDown(column)}
        >
          <button
            type="button"
            data-testid={`sort-${column}`}
            aria-disabled={sortDisabled}
            onClick={() => {
              if (consumeClickAfterDrag() || sortDisabled) {
                return;
              }
              sorted(column);
            }}
          >
            {column}
          </button>
        </span>
      ))}
      <output data-testid="sorted">{sorted.mock.calls.length}</output>
    </div>
  );
}

describe('useColumnDrag', () => {
  it('moves a column once the pointer passes the threshold', () => {
    const onColumnMove = vi.fn();
    render(<Header onColumnMove={onColumnMove} />);

    fireEvent.mouseDown(screen.getByTestId('filename'), { button: 0, clientX: 50 });
    fireEvent.mouseMove(window, { clientX: 150 });
    expect(screen.getByTestId('filename')).toHaveClass('dragging');
    expect(onColumnMove).toHaveBeenCalledWith('filename', 'size');

    fireEvent.mouseUp(window, { clientX: 150 });
    expect(screen.getByTestId('filename')).not.toHaveClass('dragging');
  });

  it('ignores a press that never really moves, so a click still sorts', () => {
    const onColumnMove = vi.fn();
    render(<Header onColumnMove={onColumnMove} />);

    fireEvent.mouseDown(screen.getByTestId('filename'), { button: 0, clientX: 50 });
    fireEvent.mouseMove(window, { clientX: 52 });
    fireEvent.mouseUp(window, { clientX: 52 });

    expect(onColumnMove).not.toHaveBeenCalled();
    expect(screen.getByTestId('filename')).not.toHaveClass('dragging');
  });

  it('swallows the click that ends a drag', () => {
    const onColumnMove = vi.fn();
    render(<Header onColumnMove={onColumnMove} />);

    fireEvent.mouseDown(screen.getByTestId('filename'), { button: 0, clientX: 50 });
    fireEvent.mouseMove(window, { clientX: 150 });
    fireEvent.mouseUp(window, { clientX: 150 });

    // Letting go over a header is reported as a click on its sort button; without the guard,
    // dropping a column would also re-sort the list.
    fireEvent.click(screen.getByTestId('sort-filename'));
    expect(screen.getByTestId('sorted')).toHaveTextContent('0');
  });

  it('cancels on Escape without moving anything', () => {
    const onColumnMove = vi.fn();
    render(<Header onColumnMove={onColumnMove} />);

    fireEvent.mouseDown(screen.getByTestId('filename'), { button: 0, clientX: 50 });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseMove(window, { clientX: 150 });

    expect(onColumnMove).not.toHaveBeenCalled();
  });

  it('still reorders when sorting is disabled by the result limit', () => {
    const onColumnMove = vi.fn();
    render(<Header onColumnMove={onColumnMove} sortDisabled />);

    // Above the sort limit the button used to carry `disabled`, which swallows mouse events
    // instead of bubbling them: the press never reached the cell and the column would not move.
    fireEvent.mouseDown(screen.getByTestId('sort-filename'), { button: 0, clientX: 50 });
    fireEvent.mouseMove(window, { clientX: 150 });
    fireEvent.mouseUp(window, { clientX: 150 });

    expect(onColumnMove).toHaveBeenCalledWith('filename', 'size');
  });
});
