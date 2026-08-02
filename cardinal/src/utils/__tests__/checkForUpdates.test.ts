import { describe, expect, it } from 'vitest';
import { compareVersions } from '../checkForUpdates';

describe('compareVersions', () => {
  it('orders releases, ignoring the tag prefix', () => {
    expect(compareVersions('0.3.0', '0.2.0')).toBeGreaterThan(0);
    expect(compareVersions('v0.3.0', '0.3.0')).toBe(0);
    expect(compareVersions('0.2.0', '0.3.0')).toBeLessThan(0);
  });

  it('compares each part as a number, not as text', () => {
    // The string comparison everyone reaches for first says 0.10.0 < 0.9.0, and the user is
    // told they are up to date on the older build.
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
  });

  it('treats a missing part as zero', () => {
    expect(compareVersions('0.3', '0.3.0')).toBe(0);
    expect(compareVersions('0.3.1', '0.3')).toBeGreaterThan(0);
  });

  it('does not crash on a tag it cannot parse', () => {
    expect(compareVersions('nightly', '0.2.0')).toBeLessThan(0);
  });
});
