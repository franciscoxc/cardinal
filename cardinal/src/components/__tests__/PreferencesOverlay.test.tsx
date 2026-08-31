import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreferencesOverlay } from '../PreferencesOverlay';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../ThemeSwitcher', () => ({
  __esModule: true,
  default: () => <div data-testid="theme-switcher" />,
}));

vi.mock('../LanguageSwitcher', () => ({
  __esModule: true,
  default: () => <div data-testid="language-switcher" />,
}));

const baseProps = {
  open: true,
  onClose: vi.fn(),
  sortThreshold: 200,
  defaultSortThreshold: 100,
  onSortThresholdChange: vi.fn(),
  foldersFirstEnabled: true,
  onFoldersFirstEnabledChange: vi.fn(),
  deepSortThreshold: 2000,
  defaultDeepSortThreshold: 2000,
  onDeepSortThresholdChange: vi.fn(),
  trayIconEnabled: false,
  onTrayIconEnabledChange: vi.fn(),
  watchRoot: '/old/root',
  defaultWatchRoot: '/default/root',
  ignorePaths: ['/ignore/a', '/ignore/b'],
  defaultIgnorePaths: ['/default/ignore'],
  includePaths: ['/include/a'],
  defaultIncludePaths: [] as string[],
  onReset: vi.fn(),
  themeResetToken: 0,
  onWatchConfigChange: vi.fn(),
  folderSizesEnabled: false,
  onFolderSizesEnabledChange: vi.fn(),
  deepFolderSizesEnabled: false,
  onDeepFolderSizesEnabledChange: vi.fn(),
  sizeColumnVisible: true,
};

describe('PreferencesOverlay', () => {
  it('saves watch root updates via onWatchConfigChange', () => {
    const onWatchConfigChange = vi.fn();
    render(<PreferencesOverlay {...baseProps} onWatchConfigChange={onWatchConfigChange} />);

    const watchRootInput = screen.getByLabelText('watchRoot.label');
    fireEvent.change(watchRootInput, { target: { value: '/new/root' } });

    fireEvent.click(screen.getByText('preferences.save'));

    expect(onWatchConfigChange).toHaveBeenCalledWith({
      watchRoot: '/new/root',
      ignorePaths: baseProps.ignorePaths,
      includePaths: baseProps.includePaths,
    });
  });

  it('saves ignore path updates via onWatchConfigChange', () => {
    const onWatchConfigChange = vi.fn();
    render(<PreferencesOverlay {...baseProps} onWatchConfigChange={onWatchConfigChange} />);

    const ignorePathsInput = screen.getByLabelText('ignorePaths.label');
    fireEvent.change(ignorePathsInput, { target: { value: '/tmp/one\n/tmp/two' } });

    fireEvent.click(screen.getByText('preferences.save'));

    expect(onWatchConfigChange).toHaveBeenCalledWith({
      watchRoot: baseProps.watchRoot,
      ignorePaths: ['/tmp/one', '/tmp/two'],
      includePaths: baseProps.includePaths,
    });
  });

  it('saves include path updates via onWatchConfigChange', () => {
    const onWatchConfigChange = vi.fn();
    render(<PreferencesOverlay {...baseProps} onWatchConfigChange={onWatchConfigChange} />);

    const includePathsInput = screen.getByLabelText('includePaths.label');
    fireEvent.change(includePathsInput, {
      target: { value: '/Volumes/media\n/Volumes/work' },
    });

    fireEvent.click(screen.getByText('preferences.save'));

    expect(onWatchConfigChange).toHaveBeenCalledWith({
      watchRoot: baseProps.watchRoot,
      ignorePaths: baseProps.ignorePaths,
      includePaths: ['/Volumes/media', '/Volumes/work'],
    });
  });

  it('blocks save when an include path is not absolute', () => {
    const onWatchConfigChange = vi.fn();
    render(<PreferencesOverlay {...baseProps} onWatchConfigChange={onWatchConfigChange} />);

    const includePathsInput = screen.getByLabelText('includePaths.label');
    fireEvent.change(includePathsInput, { target: { value: 'relative/path' } });

    const saveButton = screen.getByText('preferences.save') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    fireEvent.click(saveButton);
    expect(onWatchConfigChange).not.toHaveBeenCalled();
  });

  it('resets inputs to defaults before invoking onReset', () => {
    const onReset = vi.fn();
    const onWatchConfigChange = vi.fn();
    const onSortThresholdChange = vi.fn();
    render(
      <PreferencesOverlay
        {...baseProps}
        onReset={onReset}
        onWatchConfigChange={onWatchConfigChange}
        onSortThresholdChange={onSortThresholdChange}
      />,
    );

    fireEvent.click(screen.getByText('preferences.reset'));

    expect(screen.getByLabelText('preferences.sortingLimit.label')).toHaveValue(
      String(baseProps.defaultSortThreshold),
    );
    expect(screen.getByLabelText('watchRoot.label')).toHaveValue(baseProps.defaultWatchRoot);
    expect(screen.getByLabelText('ignorePaths.label')).toHaveValue(
      baseProps.defaultIgnorePaths.join('\n'),
    );
    expect(screen.getByLabelText('includePaths.label')).toHaveValue(
      baseProps.defaultIncludePaths.join('\n'),
    );
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onSortThresholdChange).not.toHaveBeenCalled();
    expect(onWatchConfigChange).not.toHaveBeenCalled();
  });

  it('applies staged reset values when saved', () => {
    const onWatchConfigChange = vi.fn();
    const onSortThresholdChange = vi.fn();
    render(
      <PreferencesOverlay
        {...baseProps}
        onWatchConfigChange={onWatchConfigChange}
        onSortThresholdChange={onSortThresholdChange}
      />,
    );

    fireEvent.click(screen.getByText('preferences.reset'));
    fireEvent.click(screen.getByText('preferences.save'));

    expect(onSortThresholdChange).toHaveBeenCalledWith(baseProps.defaultSortThreshold);
    expect(onWatchConfigChange).toHaveBeenCalledWith({
      watchRoot: baseProps.defaultWatchRoot,
      ignorePaths: baseProps.defaultIgnorePaths,
      includePaths: baseProps.defaultIncludePaths,
    });
  });

  it('closes preferences on Escape while editing a field', () => {
    const onClose = vi.fn();
    render(<PreferencesOverlay {...baseProps} onClose={onClose} />);

    const includePathsInput = screen.getByLabelText('includePaths.label');
    fireEvent.change(includePathsInput, { target: { value: '/tmp/changed' } });
    fireEvent.keyDown(includePathsInput, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers folder sizes as off, and as unavailable without the Size column', () => {
    const onFolderSizesEnabledChange = vi.fn();
    const { rerender } = render(
      <PreferencesOverlay {...baseProps} onFolderSizesEnabledChange={onFolderSizesEnabledChange} />,
    );

    const toggle = screen.getByLabelText('preferences.folderSizes.label') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(onFolderSizesEnabledChange).toHaveBeenCalledWith(true);

    // With the column hidden the switch has nowhere to show its answer, so it is unavailable —
    // but the stored intent is not cleared behind the user's back.
    rerender(<PreferencesOverlay {...baseProps} folderSizesEnabled sizeColumnVisible={false} />);
    const disabled = screen.getByLabelText('preferences.folderSizes.label') as HTMLInputElement;
    expect(disabled.disabled).toBe(true);
    expect(disabled.checked).toBe(false);
    expect(screen.getByText('preferences.folderSizes.needsColumn')).toBeInTheDocument();
  });
});
