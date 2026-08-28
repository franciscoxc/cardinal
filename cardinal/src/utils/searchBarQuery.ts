// The search-bar controls (file type, "contains") edit the query text instead of holding filter
// state of their own, so the search bar stays the single source of truth and the user sees the
// syntax each control writes.
//
// Each control reads back only the token it authored. Anything it cannot represent faithfully — a
// negated filter, two of them, one inside a boolean group — reads as CUSTOM so the control says
// "custom" rather than lying about what the query does. This is deliberately not a query parser:
// the real parsing lives in cardinal-syntax. In particular, the terms highlighted in a content
// snippet still come from the backend, which parses the query for real; guessing them here is what
// the deleted contentQuery.ts used to do, and it drifted from the engine on negation and quoting.

export const CUSTOM = 'custom';

/** Aliases of `lookup_type_group` (search-cache/src/query.rs) that a control may have written. */
const KNOWN_TYPE_ALIASES = [
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
];

/**
 * One entry per dropdown row. `token` is written verbatim into the query, so what the user reads in
 * the bar is exactly what the engine evaluates.
 *
 * "Documents" is an OR of four groups rather than a new engine category: widening `type:doc` there
 * would silently change what `type:doc` means for everyone, including upstream's tests.
 */
export const FILE_TYPE_OPTIONS = [
  { value: 'image', icon: '🖼️', token: 'type:image' },
  { value: 'video', icon: '🎬', token: 'type:video' },
  { value: 'audio', icon: '🎵', token: 'type:audio' },
  {
    value: 'document',
    icon: '📄',
    token: '(type:doc|type:pdf|type:presentation|type:spreadsheet)',
  },
  { value: 'email', icon: '✉️', token: 'type:email' },
  { value: 'archive', icon: '🗜️', token: 'type:archive' },
  { value: 'code', icon: '⌨️', token: 'type:code' },
  { value: 'app', icon: '🚀', token: 'type:app' },
  { value: 'folder', icon: '📁', token: 'type:folder' },
] as const;

export type FileTypeValue = (typeof FILE_TYPE_OPTIONS)[number]['value'];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Removes `token` where it stands as a whole term, leaving the surrounding query untouched. */
const removeToken = (query: string, token: string): string =>
  query.replace(new RegExp(`(^|\\s)${escapeRegExp(token)}(?=\\s|$)`, 'gi'), '$1');

const collapse = (query: string) => query.replace(/\s+/g, ' ').trim();

// ponytail-keep: this looks redundant next to the token matching below and is not. A token match
// requires whitespace before `type:`, so `(type:image | *.png)` matched nothing and the dropdown
// showed "All types" for a query that filters to images. Same for a negated `!type:`.
const MENTIONS_TYPE = /(^|[\s(!])type:/i;
const MENTIONS_CONTENT = /(^|[\s(!])content:/i;

// ----- file type -----

/**
 * The type the dropdown should display: a `FileTypeValue`, `''` for "all types", or CUSTOM when the
 * query filters by type in a way the dropdown cannot represent.
 */
export const readFileType = (query: string): FileTypeValue | '' | typeof CUSTOM => {
  if (!MENTIONS_TYPE.test(query)) {
    return '';
  }
  for (const option of FILE_TYPE_OPTIONS) {
    const rest = removeToken(query, option.token);
    // Removing this one token left nothing type-shaped behind, so it describes the whole query.
    if (rest !== query && !MENTIONS_TYPE.test(rest)) {
      return option.value;
    }
  }
  return CUSTOM;
};

/** Query with its file-type filter set to `value`, or removed when `value` is empty. */
export const setFileType = (query: string, value: FileTypeValue | ''): string => {
  let base = query;
  for (const option of FILE_TYPE_OPTIONS) {
    base = removeToken(base, option.token);
  }
  // Also drop a hand-written bare alias, so picking a type never leaves two contradicting filters.
  base = base.replace(
    new RegExp(`(^|\\s)type:(${KNOWN_TYPE_ALIASES.join('|')})(?=\\s|$)`, 'gi'),
    '$1',
  );
  base = collapse(base);

  const token = FILE_TYPE_OPTIONS.find((option) => option.value === value)?.token;
  if (!token) {
    return base;
  }
  return base ? `${base} ${token}` : token;
};

// ----- contains (content:) -----

// Always quoted, so a phrase with spaces round-trips and the reader below has one shape to match.
const CONTENT_TOKEN = /(^|\s)content:"((?:[^"\\]|\\.)*)"(?=\s|$)/gi;

const unescape = (value: string) => value.replace(/\\(.)/g, '$1');

/**
 * Splits what the user typed into the words to search for, honouring quotes.
 *
 * ponytail-keep: the whole field used to become one `content:"…"`, which made two words an exact
 * phrase — the opposite of what the main bar does with the same input, ten pixels away. Typing
 * "informe mensual" there found only files with the words adjacent, and nothing explained why.
 * Loose words mean all of them; quotes mean the phrase. Same rule as the bar, same rule as every
 * other search box.
 */
export const splitContentWords = (term: string): string[] =>
  [...term.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)]
    .map((match) => (match[1] !== undefined ? unescape(match[1]) : match[2]))
    .filter((word) => word.length > 0);

/**
 * The text the "contains" field should display: the words it is searching for, `''` when the query
 * has no content filter, or CUSTOM when it has one this field cannot represent (negated or
 * grouped). Several `content:` filters read back as several words, which is what wrote them.
 */
export const readContentTerm = (query: string): string | typeof CUSTOM => {
  if (!MENTIONS_CONTENT.test(query)) {
    return '';
  }
  const matches = [...query.matchAll(CONTENT_TOKEN)];
  if (matches.length === 0) {
    return CUSTOM;
  }
  const rest = query.replace(CONTENT_TOKEN, '$1');
  if (MENTIONS_CONTENT.test(rest)) {
    return CUSTOM;
  }
  // A word that had to be quoted going in has to come back quoted, or the next keystroke in the
  // field would silently reinterpret a phrase as separate words.
  return matches
    .map((match) => unescape(match[2]))
    .map((word) => (/\s/.test(word) ? `"${word.replace(/(["\\])/g, '\\$1')}"` : word))
    .join(' ');
};

/** Query with its content filters set to `term`: one filter per word, so all of them must match. */
export const setContentTerm = (query: string, term: string): string => {
  const base = collapse(query.replace(CONTENT_TOKEN, '$1'));
  const words = splitContentWords(term);
  if (words.length === 0) {
    return base;
  }
  const tokens = words
    .map((word) => `content:"${word.replace(/(["\\])/g, '\\$1')}"`)
    .join(' ');
  return base ? `${base} ${tokens}` : tokens;
};
