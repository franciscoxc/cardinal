import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import StatusBar from '../StatusBar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const props = (
  overrides: Partial<ComponentProps<typeof StatusBar>> = {},
): ComponentProps<typeof StatusBar> => ({
  scannedFiles: 1000,
  processedEvents: 10,
  lifecycleState: 'Ready',
  searchDurationMs: 5,
  resultCount: 3,
  activeTab: 'files',
  onTabChange: vi.fn(),
  onRequestRescan: vi.fn(),
  rescanErrorCount: 0,
  skippedCloudFiles: 0,
  skippedCloudBytes: 0,
  ...overrides,
});

const rescanButton = () => screen.getByRole('button', { name: 'statusBar.aria.rescan' });

describe('StatusBar iCloud notice', () => {
  it('says nothing when every candidate was searched', () => {
    render(<StatusBar {...props()} />);
    expect(screen.queryByText(/statusBar\.skippedCloud/)).toBeNull();
  });

  it('reports how many were skipped and what they weigh', () => {
    // The size is what turns "some files were skipped" into a decision someone can make.
    render(<StatusBar {...props({ skippedCloudFiles: 42, skippedCloudBytes: 3_650_722_201 })} />);
    expect(screen.getByTitle('statusBar.skippedCloudTitle')).toBeInTheDocument();
  });
});

describe('StatusBar rescan button', () => {
  it('stays quiet while only a few event batches have been dropped', () => {
    render(<StatusBar {...props({ rescanErrorCount: 24 })} />);
    expect(rescanButton().className).not.toContain('status-rescan-button--stale');
  });

  it('asks for attention once enough have been dropped for the index to be stale', () => {
    render(<StatusBar {...props({ rescanErrorCount: 25 })} />);
    expect(rescanButton().className).toContain('status-rescan-button--stale');
  });

  it('does not ask for a rescan that cannot be started yet', () => {
    // Nagging while the button is disabled would point at something the user cannot act on.
    render(<StatusBar {...props({ rescanErrorCount: 500, lifecycleState: 'Initializing' })} />);
    expect(rescanButton()).toBeDisabled();
    expect(rescanButton().className).not.toContain('status-rescan-button--stale');
  });
});
