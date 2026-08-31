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
  ...overrides,
});

const rescanButton = () => screen.getByRole('button', { name: 'statusBar.aria.rescan' });

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
