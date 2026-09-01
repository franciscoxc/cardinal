<div align="center">
  <img src="cardinal/mac-icon_1024x1024.png" alt="Cardinal icon" width="120" height="120">
  <h1>Cardinal</h1>
  <p>Fastest and most accurate file search app for macOS — with the search brought up to the surface.</p>
  <p>
    <a href="https://github.com/franciscoxc/cardinal/releases/download/v0.5.1/Cardinal_0.5.1_aarch64.dmg"><img src="https://img.shields.io/badge/Download-Cardinal%200.5.1%20for%20macOS-D62828?style=for-the-badge&logo=apple&logoColor=white" alt="Download Cardinal 0.5.1 for macOS"></a>
  </p>
  <p>
    Signed and notarized · Apple silicon · macOS 12+
  </p>
  <img src="doc/pub/UI.gif" alt="Cardinal UI preview" width="720">
</div>

---

> This is a fork of [Cardinal](https://github.com/cardisoft/cardinal) by [cardisoft](https://github.com/cardisoft) — the best Everything alternative for macOS. The engine is theirs and it is excellent; what this fork changes is how much of it you can reach without knowing the syntax first — and a few bugs found while getting there, reported back upstream.

## What this fork adds

- **A file-type dropdown** beside the search bar: Image, Video, Audio, Document, Email, Archive, Code, App, Folder. Picking one writes the filter into the query — `type:image` — instead of hiding it, so the bar stays the single source of truth and the syntax is there to be learned.
- **A "Contains" field** for searching inside files, next to the one for names. It writes `content:"…"` the same way.
- **A context column** showing the matching text from inside each file, with the searched term highlighted, so a content search tells you *why* every result is there.
- **`type:email`** — `.eml`, `.emlx`, `.emlxpart`, `.msg`, `.mbox`, plus Outlook's own: the one-file-per-message `.olk15Message` generation and the `.olm`, `.pst`, `.ost` and `.nst` mailboxes. Mail is what nobody finds by name.
- **Folder sizes in the Size column**, which was blank for folders. Summed from the index in memory rather than by walking the disk, and only for the rows on screen; a second preference completes the total by walking the directories the index leaves out. Off by default.
- **Folders grouped ahead of files**, whichever column is sorting and in both directions, with your order still deciding within each group. On by default.
- **A folder picker.** The folder icon opens one, instead of folding the field away.
- **Columns you can reorder and hide**, the way Finder does, with the snippet next to the name by default. The layout is remembered.
- **Plain wording.** "Folder scope" is now "Search in… (whole disk)", in all 15 languages.
- **An updater that installs.** "Check for Updates…" lists what changed and, on one click, downloads the disk image and replaces the app with it: a small script waits for the app to quit, verifies the new bundle's signature before removing anything, swaps it and relaunches. Doing it by hand is still offered. No update channel and no silent replace — the app makes no network request unless asked.
- **An accessible name on the search input**, contributed upstream by [@dkattan](https://github.com/dkattan) ([#220](https://github.com/cardisoft/cardinal/pull/220)).

## What this fork fixes

Three upstream bugs, each reported back with the measurements that found it:

- **Deletions stop being lost.** One filesystem event at the watch root made the whole batch return early, throwing away every other change bundled with it — and nothing ever performed the rescan it asked for, so those changes were gone for good. Measured on a real 5.36M-node index: 237 discarded batches, and every sampled entry under `DerivedData` and `.Trash` no longer existed on disk while the index still offered it. ([#229](https://github.com/cardisoft/cardinal/issues/229))
- **A content search stops downloading your iCloud Drive.** Reading a file is what makes macOS materialise a placeholder, so searching a synced home folder quietly pulled down every PDF, video and archive that was not on the disk. The flag is now read without materialising anything, and the app says how many files it skipped and what they weigh. ([#231](https://github.com/cardisoft/cardinal/issues/231))
- **`content:` stops costing 60× more depending on word order.** It shared a filter priority with `type:`, so `content:invoice type:email` opened and read every file on the disk while `type:email content:invoice` read only the mail. It now always runs last, on the smallest candidate set. ([#230](https://github.com/cardisoft/cardinal/issues/230))

Everything below is the original project's documentation, unchanged.

---

[English](README.md) · [Español](doc/pub/README.es-ES.md) · [한국어](doc/pub/README.ko-KR.md) · [Русский](doc/pub/README.ru-RU.md) · [简体中文](doc/pub/README.zh-CN.md) · [繁體中文](doc/pub/README.zh-TW.md) · [Português](doc/pub/README.pt-BR.md) · [Italiano](doc/pub/README.it-IT.md) · [日本語](doc/pub/README.ja-JP.md) · [Français](doc/pub/README.fr-FR.md) · [Deutsch](doc/pub/README.de-DE.md) · [Українська](doc/pub/README.uk-UA.md) · [العربية](doc/pub/README.ar-SA.md) · [हिन्दी](doc/pub/README.hi-IN.md) · [Türkçe](doc/pub/README.tr-TR.md)

## Using Cardinal

### Download

[**Download Cardinal 0.5.1 for macOS**](https://github.com/franciscoxc/cardinal/releases/download/v0.5.1/Cardinal_0.5.1_aarch64.dmg) — signed with a Developer ID and notarized by Apple, so it opens without Gatekeeper warnings.

Every build lives in [Releases](https://github.com/franciscoxc/cardinal/releases). Open the DMG, drag Cardinal to Applications, and grant Full Disk Access when macOS asks — Cardinal needs it to index and watch your files.

### i18n support

Need a different language? Click the ⚙️ button in the status bar to switch instantly.

### Search basics

Cardinal now speaks an Everything-compatible syntax layer on top of the classic substring/prefix tricks:

- `report draft` – space acts as `AND`, so you only see files whose names contain both tokens.
- `*.pdf briefing` – filter to PDF results whose names include “briefing”.
- `*.zip size:>100MB` – search for ZIP files larger than 100MB.
- `in:/Users demo !.psd` – restrict the search root to `/Users`, then search for files whose names contain `demo` but exclude `.psd`.
- `tag:ProjectA;ProjectB` – match Finder tags (macOS); `;` acts as `OR`.
- `*.md content:"Bearer "` – filter to Markdown files containing the string `Bearer `.
- `"Application Support"` – quote exact phrases.
- `brary/Applicat` – use `/` as a path separator for sub-path searching, matching directories like `Library/Application Support`.
- `/report` · `draft/` · `/report/` – wrap tokens with leading and/or trailing slashes to force **prefix**, **suffix**, or **exact** name matches when you need whole-word control beyond Everything syntax.
- `~/**/.DS_Store` – globstar (`**`) dives through every subfolder under your home directory to find stray `.DS_Store` files anywhere in the tree.

For the supported operator catalog—including boolean grouping, folder scoping, extension filters, regex usage, and more examples—see [`doc/pub/search-syntax.md`](doc/pub/search-syntax.md).

### Keyboard shortcuts & previews

- `Cmd+Shift+Space` – toggle the Cardinal window globally via the quick-launch hotkey.
- `Cmd+,` – open Preferences.
- `Esc` – hide the Cardinal window.
- `ArrowUp`/`ArrowDown` – move the selection.
- `Shift+ArrowUp`/`Shift+ArrowDown` – extend the selection.
- `Space` – Quick Look the currently selected row without leaving Cardinal.
- `Cmd+O` – open the highlighted result.
- `Cmd+R` – reveal the highlighted result in Finder.
- `Cmd+C` – copy the selected files to the clipboard.
- `Cmd+Shift+C` – copy the selected paths to the clipboard.
- `Cmd+F` – jump focus back to the search bar.
- `ArrowUp`/`ArrowDown` (in search bar) – cycle search history.

Happy searching!

---

## Building Cardinal

### Requirements

- macOS 12+
- Rust toolchain
- Node.js 18+ with npm
- Xcode command-line tools & Tauri prerequisites (<https://tauri.app/start/prerequisites/>)

### Development mode

```bash
cd cardinal
npm run tauri dev -- --release --features dev
```

### Production build

```bash
cd cardinal
npm run tauri build
```
