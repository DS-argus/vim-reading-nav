# Vim Reading Navigation

An Obsidian plugin that brings vim-style **scrolling** and [Vimium](https://github.com/philc/vimium)-style **link hints** to **reading mode** when Obsidian's vim key bindings are enabled.

> A fork of [xlongfeng/obsidian-vim-scrolling](https://github.com/xlongfeng/obsidian-vim-scrolling) that adds plain `d`/`u` half-page scrolling, an `f` link hint mode, and pop-out window support. Published with the original author's approval — see [Credits](#credits).

## Features

- Vim-style instant scrolling in Reading mode, including key repeat
- Vimium-style `f` hints for visible links
- Persistent, mouse-independent Markdown previews for internal links
- Immediate system-browser opening for external links
- Cursor correction when switching from Reading mode back to the editor
- Main-window and pop-out-window support

## Key mappings

| Context | Key | Action |
| --- | --- | --- |
| Reading mode | `j` / `k` | Scroll down / up |
| Reading mode | `d` / `Ctrl+D` | Scroll down half a page |
| Reading mode | `u` / `Ctrl+U` | Scroll up half a page |
| Reading mode | `gg` / `G` | Scroll to the top / bottom |
| Reading mode | `f` | Show hints for visible links |
| Hint mode | Hint characters | Select a link |
| Internal-link preview | `Shift+J` / `Shift+K` | Scroll the preview down / up |
| Focused internal link | `Enter` | Follow the link and close the preview |
| Hint or preview mode | `Esc` | Cancel and close |

Key mappings are active only when the current Markdown view is in **Reading mode** and Obsidian's **Vim key bindings** setting is enabled. Lowercase `j`/`k` continue to scroll the note while an internal-link preview is open.

## Link previews

Selecting an internal link centers and highlights it, then opens a read-only preview that stays visible regardless of mouse movement. A plain note link renders the full note; heading and block links render only the resolved section or block.

Supported preview targets:

- Note, path, and alias links: `[[Note]]`, `[[Folder/Note]]`, `[[Note|Display text]]`
- Heading links: `[[Note#Heading]]`, `[[#Same-note heading]]`
- Block links: `[[Note#^block-id]]` and same-note block links
- Relative Markdown links to Markdown notes
- Internal links in paragraphs, lists, tables, and callouts

Current limitations:

- Links and controls inside the preview are intentionally non-interactive.
- Links inside embedded or transcluded notes are excluded to prevent incorrect relative-path resolution.
- Non-Markdown files can be focused and opened with `Enter`, but are not previewed.
- Unresolved links show an error state.
- Standard footnotes (`[^id]`), tags (`#tag`), and `obsidian://` URIs are not hint targets.

## Usage

1. Enable **Settings → Editor → Vim key bindings**.
2. Open a Markdown note in **Reading mode**.
3. Use the mappings above; press `f` to select links.

## Installation

### From the community store (recommended)

Install [**Vim Reading Navigation**](https://community.obsidian.md/plugins/vim-reading-nav) from **Settings → Community plugins → Browse**, or use the "Add to Obsidian" button on the store page.

### From source

To build the latest development version yourself:

#### Prerequisites

- [Node.js](https://nodejs.org) 18+ and npm

#### 1. Build

```bash
git clone https://github.com/DS-argus/vim-reading-nav
cd vim-reading-nav
npm install
npm run build        # type-checks, then bundles src/ → main.js
```

This produces `main.js` at the repo root. The three files Obsidian needs are `main.js`, `manifest.json`, and `styles.css`.

#### 2. Copy into your vault

Create the plugin folder if it doesn't exist, then copy the three artifacts in.

**macOS / Linux:**

```bash
cp main.js manifest.json styles.css "<Vault>/.obsidian/plugins/vim-reading-nav/"
```

**Windows (PowerShell):**

```ps1
Copy-Item main.js,manifest.json,styles.css "<Vault>\.obsidian\plugins\vim-reading-nav\"
```

> `.obsidian` is a hidden folder. The plugin folder name must match the plugin `id` (`vim-reading-nav`).

#### 3. Enable

Reload Obsidian (`Reload app without saving` from the command palette), then enable **Vim Reading Navigation** under **Settings → Community plugins**.

#### Live development

```bash
npm run dev   # watch mode — recompiles main.js on save
```

Re-copy `main.js` into the vault and reload Obsidian after each change, or point esbuild's output (`esbuild.config.mjs`) directly at your vault's plugin folder to skip the copy step.

## Credits

A fork of [**obsidian-vim-scrolling**](https://github.com/xlongfeng/obsidian-vim-scrolling) by [xlongfeng](https://github.com/xlongfeng). The original provides the reading-mode scrolling and cursor-adjustment behaviour; this fork adds:

- Plain `d` / `u` for half-page scrolling (alongside `Ctrl+D` / `Ctrl+U`)
- An `f` Vimium-style link hint mode with persistent previews and link activation
- Pop-out window support

Published to the community plugin directory with the original author's [explicit approval](https://github.com/xlongfeng/obsidian-vim-scrolling/issues/2#issuecomment-5088284571), per Obsidian's [fork policy](https://docs.obsidian.md/Developer+policies#Forks).

Distributed under the same [0BSD license](LICENSE) as the original.
