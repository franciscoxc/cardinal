# Changelog

## 0.5.0 — 2026-08-31
- Stop losing filesystem changes. A single event at the watch root made the whole batch of events return early, throwing away every deletion that came bundled with it — and since nothing ever performs the rescan it asks for, those changes were lost for good. Measured on a real 5.36M-node index: every sampled entry under `DerivedData` and `.Trash` no longer existed on disk, against none under `Documents`, and the stored counter had reached 237 discarded batches. Comes straight from upstream.
- Do not open files iCloud has not downloaded. A content search opens every candidate, and opening a placeholder is what makes macOS fetch it — so searching a synced home folder would quietly pull down every PDF, video and archive that is not on the disk. The flag is read without materialising anything.
- Say what that skipped, and what it weighs: "42 not searched · 3.40 GB in iCloud", beside the result count. A placeholder reports its real size, so the number costs nothing to know and is what makes searching them an informed choice rather than a surprise.
- Let the rescan button say when the index has gone stale. The app already counted the dropped batches and mentioned them in a tooltip nobody hovers; past 25 the button now turns red and pulses slowly.
- Install an update instead of asking for a drag. "Check for Updates…" now offers to install: the app plants a small script, quits, and the script waits for it to be gone before swapping the bundle and relaunching. It verifies the signature before removing anything, so a damaged download leaves the working app in place. "Quit and do it myself" is still there.

## 0.4.0 — 2026-08-30
- Group folders ahead of files, whichever column is sorting. A "Folders on top" switch in Preferences, on by default. The engine already knew what was a directory — the type is packed into the index during the walk, so no `stat` is involved — but it only ever used it to break ties between equal names, which in practice never happened. Grouping sits ahead of the chosen key and outside the direction flip, so folders stay on top whether a column sorts up or down, and your order still decides everything within each group.

## 0.3.9 — 2026-08-30
- Show what is in a new release, and download it from the same dialog. "Check for Updates…" used to say only that a version existed and send you to a web page; it now lists what changed and, on one click, downloads the disk image to your Downloads folder and opens it, leaving the drag onto Applications to you. Deliberately not a silent auto-updater: nothing is replaced without you doing it, and the app still makes no network request unless you ask it to.

## 0.3.8 — 2026-08-30
- Put "About Cardinal", "Check for Updates…" and "Settings" on the menu-bar icon. With the tray icon on, the app can be sitting there with no window and no Dock icon, and the menu bar is whatever app currently has focus — so there was no reliable way to reach those three, not even to read which version was running.
- Fix the "Contains" field eating a space as you typed it. The field showed the query read back, and a trailing space cannot survive that trip: `informe ` becomes `content:"informe"` and returns as `informe`, so the space vanished the instant it was typed and the next letter joined the previous word. Entering two words meant typing one, waiting, then the space.
- Run `content:` last, whatever order it was written in. It shared a priority with `type:`, so a stable sort took the cost straight from the typing order: `content:factura type:email` opened and read every file on the disk, while `type:email content:factura` read only the mail. Measured 60x apart on a tree of 6,100 files, and the gap grows with the index — on a real disk it is the app going unresponsive. Worse, the search bar itself decided which one you got: the "Contains" field and the type dropdown both append their filter, so the order came from whichever control you touched last.
- Stop searching for the empty query. It matched every node, and handing millions of indices to the webview took nearly three seconds — at launch, and again every time the search field was cleared, which the clear button put one click away. The results pane now says what to type instead, and the status bar no longer reports "0 results in 0 ms" before anything was searched for.

## 0.3.6 — 2026-08-28
- Search for every word the "Contains" field is given, instead of the exact phrase. Two words there used to mean "these words, adjacent" — the opposite of what the main bar does with the same input, ten pixels away — so typing two words found almost nothing and nothing said why. Quotes still mean the phrase, and the field's tooltip says so.
- Find Outlook mail with `type:email`. Legacy Outlook for Mac keeps every message as its own file (`.olk15Message` for the header, `.olk15MsgSource` for the full source, `.olk15MsgAttach` per attachment, and the `.olk14` generation before it), none of which were recognised. Whole mailboxes are covered too: `.olm`, `.pst`, `.ost`, `.nst` and `.oft`. `type:outlook` is an alias. The current Outlook for Mac keeps its live mail in a database rather than in files, so only its `.olm` archives can be found.
- Fix sorting by size freezing the app while it added up folders. The sums run on the loop that also answers searches and could not be interrupted, so ordering a large result set held everything for as long as the walk took — and the answer was already worthless, because the next keystroke had replaced the results. A new search now abandons them.
- Stop holding the sorted-view lock across the request it makes to that loop, which made callers queue behind a mutex as well as behind the loop.

## 0.3.5 — 2026-08-03
- Fix sorting by size, which ignored folder totals entirely. It ordered folders by the size of the directory inode — a few hundred bytes, near enough identical for every folder — so they all tied and fell back to name order while the column showed something else. Sorting now uses the total the column is showing.
- Sum many folders at once without walking anything twice. A result set routinely holds a folder together with its own ancestors, and each ancestor used to re-add everything its descendants had just added up; the cost grew with the nesting depth rather than with the number of files.
- Re-order live as the folder walk reports, so the list keeps matching the numbers it is showing. It holds off while a row is selected — re-ordering under a selection would either clear it several times a second or leave it pointing at a different file — and resumes as soon as the selection goes.
- Add a second sorting limit, for sorting by size while the folder walk is on. That ordering has to finish walking every result on disk, which nothing else waits for, so it gets its own lower ceiling (2,000) instead of borrowing the general one. Above it the Size header greys out on its own and the other columns keep sorting. The field sits in Preferences, unavailable until the walk is turned on.
- Fix walk requests being dropped past the 64th when an ordering asks for every folder in the result set. A dropped request was a folder that never grew past its indexed total.

## 0.3.4 — 2026-08-02
- Show how much a folder holds in the Size column, which until now was empty for folders. The total is summed from the index in memory rather than by walking the disk, and only for the rows on screen. Off by default: the app behaves exactly as before until you turn it on in Preferences.
- Mark a folder total with `+` when it is a lower bound, because part of the folder is unreadable or kept out of the index by the watch configuration. Hovering explains which.
- Complete a folder total by walking the excluded directories on disk, behind a second preference with a warning. The number grows on screen as the walk proceeds and drops its `+` when it finishes, since a partial sum is already a true lower bound. The walk runs on one thread at background QoS with the disk I/O throttle — the policy Spotlight and Time Machine use — and is cancelled as soon as its row scrolls out of view.
- Show or hide columns from the header's context menu, the way Finder does. The order and the hidden set are both remembered, and the file name can never be hidden — without it the list is a wall of dates and sizes. The snippet column is only offered while a content search is running.
- Hiding the snippet column now stops the work behind it: the search no longer reads every visible file to cut a snippet out of it.
- Put the caret in the search field, after a trailing space, once a filter control writes into it. Picking a type used to leave focus on the control, so the next question was whether the search term goes before or after what was written, and whether to add a space.
- Fix folder totals staying blank after hiding the Size column and showing it again. Rows were cached without the totals, and nothing asked for them until the next search.

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
