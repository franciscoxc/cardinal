// The file-type dropdown edits the query text instead of holding its own filter state, so the
// search bar stays the single source of truth and the user sees the syntax it writes.
//
// This reads back only the token the dropdown itself can author: one bare `type:<word>` from the
// closed list below. Anything the widget cannot represent faithfully — a negated `!type:`, two
// `type:` tokens, or one inside a boolean group — reports CUSTOM_FILE_TYPE so the control says
// "custom" rather than lying about what the query does. It is deliberately not a query parser:
// the real parsing lives in cardinal-syntax, and duplicating it here would drift.

/// Values written into the query. Each is the primary alias of a group in `lookup_type_group`
/// (search-cache/src/query.rs), so what the dropdown writes is exactly what the engine matches.
export const FILE_TYPE_VALUES = [
  'image',
  'video',
  'audio',
  'doc',
  'pdf',
  'presentation',
  'spreadsheet',
  'email',
  'archive',
  'code',
  'app',
  'folder',
] as const;

export type FileTypeValue = (typeof FILE_TYPE_VALUES)[number];

export const CUSTOM_FILE_TYPE = 'custom';

// Leading `\s` (or string start) keeps this from matching inside a quoted phrase such as
// `content:"type:image"`, where the preceding character is a quote.
const TYPE_TOKEN = /(^|\s)(!?)type:([A-Za-z]+)(?=\s|$)/gi;

// Boolean grouping means a `type:` token may apply to only part of the query, so the dropdown
// cannot claim it describes the whole result set.
const HAS_GROUPING = /[()|]|\bOR\b/i;

// Any `type:` acting as a filter, including the forms TYPE_TOKEN deliberately does not capture
// (negated, parenthesised). Without this a query like `(type:image | *.png)` would match no token
// and read as "all types" — the one answer that is certainly wrong.
const MENTIONS_TYPE = /(^|[\s(!])type:/i;

const isKnown = (value: string): value is FileTypeValue =>
  (FILE_TYPE_VALUES as readonly string[]).includes(value.toLowerCase());

/**
 * The type the dropdown should display: a `FileTypeValue`, `''` for "all", or `CUSTOM_FILE_TYPE`
 * when the query filters by type in a way the dropdown cannot represent.
 */
export const readFileType = (query: string): FileTypeValue | '' | typeof CUSTOM_FILE_TYPE => {
  if (!MENTIONS_TYPE.test(query)) {
    return '';
  }
  const matches = [...query.matchAll(TYPE_TOKEN)];
  if (matches.length !== 1 || matches[0][2] === '!' || HAS_GROUPING.test(query)) {
    return CUSTOM_FILE_TYPE;
  }
  const value = matches[0][3].toLowerCase();
  return isKnown(value) ? (value as FileTypeValue) : CUSTOM_FILE_TYPE;
};

/**
 * Query with its file-type filter set to `value` (or removed when `value` is empty). Only tokens
 * this module recognises are dropped, so a hand-written `!type:` or a grouped one survives.
 */
export const setFileType = (query: string, value: FileTypeValue | ''): string => {
  const withoutKnown = query.replace(TYPE_TOKEN, (token, lead, negation, name: string) =>
    negation === '' && isKnown(name) ? (lead as string) : token,
  );
  const base = withoutKnown.replace(/\s+/g, ' ').trim();
  if (!value) {
    return base;
  }
  return base ? `${base} type:${value}` : `type:${value}`;
};
