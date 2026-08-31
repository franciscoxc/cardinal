import { describe, expect, it } from 'vitest';
import { formatKB, formatBytes } from '../format';

describe('formatKB', () => {
  it('formats whole kilobytes without decimal digits', () => {
    expect(formatKB(2048)).toBe('2.0 KB');
  });

  it('formats small values with a single decimal place', () => {
    expect(formatKB(1536)).toBe('1.5 KB');
  });

  it('returns null for nullish or non-finite inputs', () => {
    expect(formatKB(null)).toBeNull();
    expect(formatKB(undefined)).toBeNull();
    expect(formatKB(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('formatBytes', () => {
  it('picks a unit that keeps the number readable', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1024)).toBe('1.00 KB');
    expect(formatBytes(3_650_722_201)).toBe('3.40 GB');
  });

  it('drops decimals once the number is big enough not to need them', () => {
    expect(formatBytes(150 * 1024)).toBe('150 KB');
    expect(formatBytes(15 * 1024)).toBe('15.0 KB');
  });

  it('returns null rather than a bogus string for nothing', () => {
    expect(formatBytes(null)).toBe(null);
    expect(formatBytes(undefined)).toBe(null);
    expect(formatBytes(-1)).toBe(null);
  });
});
