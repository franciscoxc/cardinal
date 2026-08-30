import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { open } from '@tauri-apps/plugin-dialog';
import { SearchBar } from '../SearchBar';

// The bar now labels the file-type dropdown through i18n; keys are enough for these assertions.
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const baseProps = (
  overrides: Partial<ComponentProps<typeof SearchBar>> = {},
): ComponentProps<typeof SearchBar> => {
  const props: ComponentProps<typeof SearchBar> = {
    inputRef: createRef<HTMLInputElement>(),
    placeholder: 'Search',
    ariaLabel: 'Search input',
    value: '',
    onChange: vi.fn(),
    onKeyDown: vi.fn(),
    directoryScopeEnabled: true,
    directoryScopeOpen: true,
    directoryScopeLabel: 'Folder scope',
    directoryPlaceholder: 'Folder',
    directoryValue: '',
    onToggleDirectoryScope: vi.fn(),
    onDirectoryChange: vi.fn(),
    onDirectoryKeyDown: vi.fn(),
    caseSensitive: false,
    onToggleCaseSensitive: vi.fn(),
    caseSensitiveLabel: 'Case sensitive',
    fileTypeEnabled: true,
    onQueryValueChange: vi.fn(),
    onDirectoryValueChange: vi.fn(),
    onFocus: vi.fn(),
    onBlur: vi.fn(),
    ...overrides,
  };
  return props;
};

const renderSearchBar = (overrides: Partial<ComponentProps<typeof SearchBar>> = {}) => {
  const props = baseProps(overrides);
  render(<SearchBar {...props} />);
  return props;
};

describe('SearchBar', () => {
  it('does not mark the folder scope toggle as pressed while folded with a saved value', () => {
    const onToggleDirectoryScope = vi.fn();
    renderSearchBar({
      directoryScopeOpen: false,
      directoryValue: 'Work/Docs',
      onToggleDirectoryScope,
    });

    const toggle = screen.getByRole('button', { name: 'Folder scope' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(onToggleDirectoryScope).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('browses for a folder with the folder icon, and folds with the chevron beside it', async () => {
    const onToggleDirectoryScope = vi.fn();
    const onDirectoryValueChange = vi.fn();
    vi.mocked(open).mockResolvedValueOnce('/Users/someone/Documents');
    renderSearchBar({ onToggleDirectoryScope, onDirectoryValueChange });

    // The folder icon used to fold the field, which read as a lie: it looks like "pick a folder".
    const browse = screen.getByRole('button', { name: 'search.directory.browse' });
    expect(browse).toHaveClass('directory-scope-field-toggle');
    fireEvent.click(browse);
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(expect.objectContaining({ directory: true })),
    );
    await waitFor(() =>
      expect(onDirectoryValueChange).toHaveBeenCalledWith('/Users/someone/Documents'),
    );
    expect(onToggleDirectoryScope).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'search.directory.close' }));
    expect(onToggleDirectoryScope).toHaveBeenCalledTimes(1);
  });

  it('leaves the folder untouched when the picker is cancelled', async () => {
    const onDirectoryValueChange = vi.fn();
    vi.mocked(open).mockResolvedValueOnce(null);
    renderSearchBar({ onDirectoryValueChange });

    fireEvent.click(screen.getByRole('button', { name: 'search.directory.browse' }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(onDirectoryValueChange).not.toHaveBeenCalled();
  });

  it('writes each word the contains field types as its own content filter', () => {
    const onQueryValueChange = vi.fn();
    renderSearchBar({ value: 'informe', onQueryValueChange });

    const contains = screen.getByPlaceholderText('search.content.hint');
    fireEvent.change(contains, { target: { value: 'Bearer token' } });
    expect(onQueryValueChange).toHaveBeenCalledWith('informe content:"Bearer" content:"token"');
  });

  it('routes directory input focus state through the shared search focus handlers', () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    renderSearchBar({ onFocus, onBlur });
    const directoryInput = screen.getByPlaceholderText('Folder');

    onFocus.mockClear();
    fireEvent.focus(directoryInput);
    expect(onFocus).toHaveBeenCalledTimes(1);

    fireEvent.blur(directoryInput);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('does not render a directory resize separator', () => {
    renderSearchBar();

    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('moves focus from the query start to the directory input with ArrowLeft', () => {
    const queryRef = createRef<HTMLInputElement>();
    const onKeyDown = vi.fn();
    renderSearchBar({
      inputRef: queryRef,
      value: 'report',
      directoryValue: 'Work/Docs',
      onKeyDown,
    });
    const directoryInput = screen.getByPlaceholderText('Folder') as HTMLInputElement;
    const queryInput = screen.getByPlaceholderText('Search') as HTMLInputElement;

    queryInput.focus();
    queryInput.setSelectionRange(0, 0);
    fireEvent.keyDown(queryInput, { key: 'ArrowLeft' });

    expect(document.activeElement).toBe(directoryInput);
    expect(directoryInput.selectionStart).toBe('Work/Docs'.length);
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('moves focus from the directory end to the query input with ArrowRight', () => {
    const onDirectoryKeyDown = vi.fn();
    renderSearchBar({
      value: 'report',
      directoryValue: 'Work/Docs',
      onDirectoryKeyDown,
    });
    const directoryInput = screen.getByPlaceholderText('Folder') as HTMLInputElement;
    const queryInput = screen.getByPlaceholderText('Search') as HTMLInputElement;

    directoryInput.focus();
    directoryInput.setSelectionRange('Work/Docs'.length, 'Work/Docs'.length);
    fireEvent.keyDown(directoryInput, { key: 'ArrowRight' });

    expect(document.activeElement).toBe(queryInput);
    expect(queryInput.selectionStart).toBe(0);
    expect(onDirectoryKeyDown).not.toHaveBeenCalled();
  });

  it('does not move from query to directory when ArrowLeft has modifiers or selection is not at the start', () => {
    const onKeyDown = vi.fn();
    renderSearchBar({
      value: 'report',
      directoryValue: 'Work/Docs',
      onKeyDown,
    });
    const directoryInput = screen.getByPlaceholderText('Folder') as HTMLInputElement;
    const queryInput = screen.getByPlaceholderText('Search') as HTMLInputElement;

    queryInput.focus();
    queryInput.setSelectionRange(0, 0);
    fireEvent.keyDown(queryInput, { key: 'ArrowLeft', metaKey: true });
    expect(document.activeElement).toBe(queryInput);
    expect(onKeyDown).toHaveBeenCalledTimes(1);

    onKeyDown.mockClear();
    queryInput.setSelectionRange(1, 1);
    fireEvent.keyDown(queryInput, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(queryInput);
    expect(onKeyDown).toHaveBeenCalledTimes(1);

    onKeyDown.mockClear();
    queryInput.setSelectionRange(0, 2);
    fireEvent.keyDown(queryInput, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(queryInput);
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(directoryInput);
  });

  it('does not move from query to directory when the folder scope is folded', () => {
    const onKeyDown = vi.fn();
    renderSearchBar({
      directoryScopeOpen: false,
      value: 'report',
      directoryValue: 'Work/Docs',
      onKeyDown,
    });
    const queryInput = screen.getByPlaceholderText('Search') as HTMLInputElement;

    queryInput.focus();
    queryInput.setSelectionRange(0, 0);
    fireEvent.keyDown(queryInput, { key: 'ArrowLeft' });

    expect(document.activeElement).toBe(queryInput);
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('does not move from directory to query when ArrowRight has modifiers or selection is not at the end', () => {
    const onDirectoryKeyDown = vi.fn();
    renderSearchBar({
      value: 'report',
      directoryValue: 'Work/Docs',
      onDirectoryKeyDown,
    });
    const directoryInput = screen.getByPlaceholderText('Folder') as HTMLInputElement;
    const queryInput = screen.getByPlaceholderText('Search') as HTMLInputElement;

    directoryInput.focus();
    directoryInput.setSelectionRange('Work/Docs'.length, 'Work/Docs'.length);
    fireEvent.keyDown(directoryInput, { key: 'ArrowRight', shiftKey: true });
    expect(document.activeElement).toBe(directoryInput);
    expect(onDirectoryKeyDown).toHaveBeenCalledTimes(1);

    onDirectoryKeyDown.mockClear();
    directoryInput.setSelectionRange(1, 1);
    fireEvent.keyDown(directoryInput, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(directoryInput);
    expect(onDirectoryKeyDown).toHaveBeenCalledTimes(1);

    onDirectoryKeyDown.mockClear();
    directoryInput.setSelectionRange(0, 'Work/Docs'.length);
    fireEvent.keyDown(directoryInput, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(directoryInput);
    expect(onDirectoryKeyDown).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(queryInput);
  });

  it('writes the picked file type into the query and reflects what is already there', () => {
    const onQueryValueChange = vi.fn();
    renderSearchBar({ value: 'informe', onQueryValueChange });

    const select = screen.getByLabelText('search.fileType.label') as HTMLSelectElement;
    expect(select.value).toBe('');

    fireEvent.change(select, { target: { value: 'image' } });
    // Ends on a space, and the caret goes there: picking a filter should not leave the user
    // wondering whether their term goes before or after what the control wrote.
    expect(onQueryValueChange).toHaveBeenCalledWith('informe type:image ');
  });

  it('keeps a space while it is being typed, so two words can be entered in one go', () => {
    const onQueryValueChange = vi.fn();
    const { rerender } = render(<SearchBar {...baseProps({ value: '', onQueryValueChange })} />);
    const contains = screen.getByPlaceholderText('search.content.hint') as HTMLInputElement;

    fireEvent.change(contains, { target: { value: 'informe' } });
    expect(onQueryValueChange).toHaveBeenLastCalledWith('content:"informe"');

    // The query comes back without the trailing space — it cannot encode one — so a fully
    // controlled field erased it as soon as it was typed, and the next letter joined the words.
    rerender(<SearchBar {...baseProps({ value: 'content:"informe"', onQueryValueChange })} />);
    fireEvent.change(contains, { target: { value: 'informe ' } });
    expect(contains.value).toBe('informe ');

    fireEvent.change(contains, { target: { value: 'informe mensual' } });
    expect(onQueryValueChange).toHaveBeenLastCalledWith('content:"informe" content:"mensual"');
  });

  it('shows a custom entry, and changes nothing, for a query it cannot represent', () => {
    const onQueryValueChange = vi.fn();
    renderSearchBar({ value: 'informe !type:image', onQueryValueChange });

    const select = screen.getByLabelText('search.fileType.label') as HTMLSelectElement;
    expect(select.value).toBe('custom');

    fireEvent.change(select, { target: { value: 'custom' } });
    expect(onQueryValueChange).not.toHaveBeenCalled();
  });

  it('puts the caret after the filter it wrote, ready for the search term', async () => {
    const queryRef = createRef<HTMLInputElement>();
    renderSearchBar({ inputRef: queryRef, value: 'informe', onQueryValueChange: vi.fn() });

    fireEvent.change(screen.getByLabelText('search.fileType.label'), {
      target: { value: 'image' },
    });

    await waitFor(() => expect(document.activeElement).toBe(queryRef.current));
    const caret = queryRef.current?.selectionStart;
    expect(caret).toBe(queryRef.current?.value.length);
  });
});
