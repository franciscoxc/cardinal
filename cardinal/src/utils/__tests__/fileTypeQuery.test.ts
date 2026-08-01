import { describe, expect, it } from 'vitest';
import { CUSTOM_FILE_TYPE, readFileType, setFileType } from '../fileTypeQuery';

describe('readFileType', () => {
  it('reads the token the dropdown writes', () => {
    expect(readFileType('informe type:image')).toBe('image');
    expect(readFileType('TYPE:PDF')).toBe('pdf');
    expect(readFileType('informe')).toBe('');
  });

  it('reports custom when it cannot represent the query faithfully', () => {
    expect(readFileType('informe !type:image')).toBe(CUSTOM_FILE_TYPE);
    expect(readFileType('type:image type:video')).toBe(CUSTOM_FILE_TYPE);
    expect(readFileType('(type:image | *.png)')).toBe(CUSTOM_FILE_TYPE);
    expect(readFileType('type:unknownthing')).toBe(CUSTOM_FILE_TYPE);
  });

  it('ignores a type: that is part of a quoted value, not a filter', () => {
    expect(readFileType('content:"type:image"')).toBe('');
  });
});

describe('setFileType', () => {
  it('replaces its own token and leaves the rest of the query alone', () => {
    expect(setFileType('informe type:image', 'video')).toBe('informe type:video');
    expect(setFileType('informe type:image', '')).toBe('informe');
    expect(setFileType('', 'pdf')).toBe('type:pdf');
    expect(setFileType('informe', 'email')).toBe('informe type:email');
  });

  it('keeps tokens it did not write', () => {
    expect(setFileType('!type:image informe', 'pdf')).toBe('!type:image informe type:pdf');
  });
});
