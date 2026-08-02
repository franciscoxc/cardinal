# Changelog

## Unreleased
- Show or hide columns from the header's context menu, the way Finder does. The order and the hidden set are both remembered, and the file name can never be hidden — without it the list is a wall of dates and sizes. The snippet column is only offered while a content search is running.
- Hiding the snippet column now stops the work behind it: the search no longer reads every visible file to cut a snippet out of it.

## 0.3.3 — 2026-08-02
- Fix columns not being draggable above the sort limit (20,000 results by default). Sorting is switched off there on purpose, but it was doing so with the `disabled` attribute, which swallows mouse events instead of bubbling them — so the press never reached the header cell and reordering died with it. Reordering is a layout choice and has nothing to do with how many results are on screen.

## 0.3.2 — 2026-08-02
- Fix result rows not following the column order: the header reordered but the rows kept the original layout, so every column's title sat over the wrong content.
- Fix the four non-filename columns collapsing to their 30px minimum for the whole session when the first render happened before the window had its real size. Only the filename column ever recovered, which left the rest unreadable and too small to drag or resize.

## 0.3.1 — 2026-08-02
- Fix column reordering, which did not work at all: the header showed a translucent title and dropped nothing. Tauri's webview claims drag-and-drop natively so the page can receive dropped files, which swallows the events HTML5 dragging needs. Reordering now runs on pointer events, and shows the column darkened and shuffling as you drag.
- Add a clear button to the search field, the "Contains" field, the file-type dropdown and "Search in".
- Start with "Search in" folded. A scope restored from a previous session narrows every search while being easy to miss.
- Change the "Contains" placeholder to "(search inside)".

## 0.3.0 — 2026-08-02
- Add "Check for Updates…" to the Cardinal menu. It asks GitHub for the latest release, says whether you are current, and offers the download page only when there is something newer.
- Fix the Help menu's updates entry, which opened the upstream project's releases rather than this fork's.
- Add a "Contains" field to the search bar for searching inside files. It writes `content:"…"` into the query, the same way the file-type dropdown writes `type:`.
- Add icons to the file-type dropdown, and fold Document, PDF, Presentation and Spreadsheet into one "Document" entry. The entry writes an OR of the four groups rather than changing what `type:doc` means.
- The folder icon in "Search in" now opens a folder picker. Folding the field moved to a chevron beside it, since an icon that looks like "choose a folder" should choose a folder.
- Show the default scope in the placeholder: "Search in… (whole disk)".
- Move the content-snippet column next to the file name, and let columns be reordered by dragging their titles. The order is remembered.
- Make the icon's sparkles orange; the pale gold disappeared against light backgrounds.

## 0.2.0 — 2026-08-01
- Add an accessible name to the search input, so assistive technologies can announce it. Thanks to [@dkattan](https://github.com/dkattan) ([#220](https://github.com/cardisoft/cardinal/pull/220)).
- Add a file-type dropdown next to the search bar. Picking a type writes it into the query (`type:image`), so the control and the search bar never disagree — and the syntax stays visible instead of hidden behind a menu.
- Add the `type:email` category (`.eml`, `.emlx`, `.emlxpart`, `.msg`, `.mbox`), with `mail`/`message` as synonyms.
- Rename "folder scope" to plain "Search in" across all 15 languages.
- Add a context column for `content:` searches, showing the matching text inside each file with the searched term highlighted.
- Derive the highlighted content terms from the query parser itself, so negated terms (`!content:`) no longer highlight and `content:"Bearer "` keeps its trailing space.
- Hydrate result rows in parallel, so icon and content-snippet reads no longer queue up behind each other.

## 0.1.23 — 2026-03-25
- Reduce power consumption by expanding the default ignored paths to cover more macOS cache, log, metadata, and runtime directories.
- Further reduce background work by making the filesystem event watcher honor ignored paths.
- Improve Unicode path matching by searching both NFC and NFD-equivalent query forms.

## 0.1.22 — 2026-03-08
- Add `~/Library/CloudStorage` to default ignored paths to avoid initial indexing delays
- Make index building cancellable
- Fix unexpected indexing of files in ignored directories
- Fix stale selection affecting context menu targets
- Fix lost sort state and incorrect tooltip when search results are empty
- Speed up scanning/search by removing redundant index-map and ignore-path checks

## 0.1.21 — 2026-01-23
- Add shortcut `cmd+shift+c` for copy-paths
- Allow partial-quoted queries: `"Application Support"/**`
- Add drag-and-drop support for search input
- Faster wildcard search.
- Exclude more cloud storage paths from icon generation for better performance.
- Better experience for non-root monitor path
- Better experience for panel switching
- Fix duplicate results of globstar `**` search

## 0.1.20 — 2026-01-11
- Improve context menu for multiple selections.
- Add copy file(s) to clipboard support.
- Add shorthand aliases for `tag` and `infolder` filters.
- Hide the dock icon when the tray icon is enabled.

## 0.1.19 — 2026-01-10
- Add watch roots and ignore paths to settings.
- Avoid unnecessary rescan on FSEvent::Rescan.
- Handle Enter key in search input.

## 0.1.18 — 2025-12-15
- Add option for tray icon and defaults to disable
- Persistent cache when idle or enter background.
- Improve i18n locale detection and add zh-TW translation.
- Make tags filtering accepts multiple value.
- Supports `shift+arrow` to select multiple rows.
- Various UI/UX improvements and bug fixes.

## 0.1.17 — 2025-12-10
- Add `tag:` filter support so Finder tags can scope searches.
- Better i18n support.
- Improve the column resizing experience
- Improve the sorting experience

## 0.1.16 — 2025-12-08
- Improve sort order so directories are prioritized and folder size ranking stays stable.
- Refine selection handling for smoother keyboard and pointer interactions.
- Add an event column to the events panel for better debugging context.
- Fix the cursor state resetting incorrectly after Quick Look opens.

## 0.1.15 — 2025-12-06
- Implement double asterisk `**` in glob search.
- Implement history navigation with `ArrowUp`/`ArrowDown` for search bar.
- Add `Cmd+O` shortcut for file opening.
- Refined QuickLook animation positioning logic to better handle multiple monitor setups.
- Refined file row selection handling.

## 0.1.14 — 2025-12-03
- Make the results sortable(by name, path, size, create_time, modify_time)

## 0.1.13 — 2025-12-01
- 30% lower memory usage
- Quick Look is now fully native, with multi-file previews, smoother animations, and better alignment with macOS expectations. Thanks for [@Denis Stoyanov](https://github.com/xgrommx) for the help!
- Support `~` expansion in query path and filter
- Fix the database path so cache files land in the correct app config directory.

## 0.1.12 — 2025-11-27
- Allow double-clicking a result row to open the file immediately.
- Support wildcards in multi-path-segment queries for more flexible searches.

## 0.1.11 — 2025-11-25
- Implement `content:`, `nosubfolders:`filter
- Improve file selection and drag-drop support
- Cleaner app menu and context menu
- make ESC hide main window

## 0.1.10 — 2025-11-19
- Added new metadata filters (`dm:`, `dc:`, `type:`, `audio:`, `video:`, `doc:`, `exe:`, `size:`) for more precise searches.
- Reworked the parser/optimizer pipeline to flatten redundant AND/OR groups, collapse empty expressions, and reorder metadata filters for faster searching.
- Use the native context menu on right-click for a more consistent feel on macOS.

## 0.1.9 — 2025-11-17
- Speedup `parent:` and `infolder:` filters.

## 0.1.8 — 2025-11-16
- Cardinal now fully supports the "Everything syntax"(AND/OR/NOT, parentheses, quoted phrases, wildcards).
- Removed the legacy regex toggle and unified the search bar, hooks, and IPC payloads around the new parser pipeline.
- Highlight of search results was improved.
- Enhance show/hide shortcut.

## 0.1.7 — 2025-11-12
- Added a cancellable search pipeline for a more responsive search experience.
- Refined selected row styling with dedicated text color tokens for better contrast in both themes.

## 0.1.6 — 2025-11-11
- Further optimized search execution and reorganized the search cache for faster lookups.

## 0.1.5 — 2025-11-09
- search-cache: widen `NameAndParent` filename length tracking from `u8` to `u32` to handle very long paths without truncation or panic.

## 0.1.4 — 2025-11-09
- Fix i18n support for tray menu.
- Rescans now clickable while updating cache.

## 0.1.3 — 2025-11-08
- Added keyboard shortcuts for Quick Look (Space), Finder reveal (Cmd+R), copy path (Cmd+C), and refocusing search (Cmd+F).
- The search field auto-focuses after launch and whenever the quick-launch shortcut summons Cardinal.
- i18n: add Ukrainian language support and translations

## 0.1.2 — 2025-11-07
- feat(shortcut&tray): support global shortcut to toggle cardinal by [@Binlogo](https://github.com/Binlogo)
- feat(theme): implement theme switching functionality with user preferences
- feat(context-menu): add “copy filename” option and update translations
- feat(i18n): add Russian language support and translations

## 0.1.1 — 2025-11-07
- Fixes iCloud download triggered by thumbnail generation.

## 0.1.0 — 2025-11-07
