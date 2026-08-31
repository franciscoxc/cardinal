<div align="center">
  <img src="cardinal/mac-icon_1024x1024.png" alt="Cardinal icon" width="120" height="120">
  <h1>Cardinal</h1>
  <p>Fastest and most accurate file search app for macOS — with the search brought up to the surface.</p>
  <p>
    <a href="https://github.com/franciscoxc/cardinal/releases/download/v0.4.0/Cardinal_0.4.0_aarch64.dmg"><img src="https://img.shields.io/badge/Download-Cardinal%200.4.0%20for%20macOS-D62828?style=for-the-badge&logo=apple&logoColor=white" alt="Download Cardinal 0.4.0 for macOS"></a>
  </p>
  <p>
    Signed and notarized · Apple silicon · macOS 12+
  </p>
  <img src="doc/pub/UI.gif" alt="Cardinal UI preview" width="720">
</div>

---

> This is a fork of [Cardinal](https://github.com/cardisoft/cardinal) by [cardisoft](https://github.com/cardisoft) — the best Everything alternative for macOS. The engine is theirs and it is excellent; what this fork changes is how much of it you can reach without knowing the syntax first.

## What this fork adds

- **A file-type dropdown** beside the search bar: Image, Video, Audio, Document, Email, Archive, Code, App, Folder. Picking one writes the filter into the query — `type:image` — instead of hiding it, so the bar stays the single source of truth and the syntax is there to be learned.
- **A "Contains" field** for searching inside files, next to the one for names. It writes `content:"…"` the same way.
- **A context column** showing the matching text from inside each file, with the searched term highlighted, so a content search tells you *why* every result is there.
- **`type:email`** — `.eml`, `.emlx`, `.emlxpart`, `.msg`, `.mbox`. Apple Mail's formats are the ones nobody finds by name.
- **A folder picker.** The folder icon opens one, instead of folding the field away.
- **Columns you can reorder** by dragging their titles, with the snippet next to the name by default.
- **Plain wording.** "Folder scope" is now "Search in… (whole disk)", in all 15 languages.
- **An accessible name on the search input**, contributed upstream by [@dkattan](https://github.com/dkattan) ([#220](https://github.com/cardisoft/cardinal/pull/220)).

Everything below is the original project's documentation, unchanged.

---

[English](README.md) · [Español](doc/pub/README.es-ES.md) · [한국어](doc/pub/README.ko-KR.md) · [Русский](doc/pub/README.ru-RU.md) · [简体中文](doc/pub/README.zh-CN.md) · [繁體中文](doc/pub/README.zh-TW.md) · [Português](doc/pub/README.pt-BR.md) · [Italiano](doc/pub/README.it-IT.md) · [日本語](doc/pub/README.ja-JP.md) · [Français](doc/pub/README.fr-FR.md) · [Deutsch](doc/pub/README.de-DE.md) · [Українська](doc/pub/README.uk-UA.md) · [العربية](doc/pub/README.ar-SA.md) · [हिन्दी](doc/pub/README.hi-IN.md) · [Türkçe](doc/pub/README.tr-TR.md)

## Using Cardinal

### Download

[**Download Cardinal 0.4.0 for macOS**](https://github.com/franciscoxc/cardinal/releases/download/v0.4.0/Cardinal_0.4.0_aarch64.dmg) — signed with a Developer ID and notarized by Apple, so it opens without Gatekeeper warnings.

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
