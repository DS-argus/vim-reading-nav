# Vim Reading Navigation

An Obsidian plugin that brings vim-style **scrolling** and [Vimium](https://github.com/philc/vimium)-style **link hints** to **reading mode** when Obsidian's vim key bindings are enabled.

> A fork of [xlongfeng/obsidian-vim-scrolling](https://github.com/xlongfeng/obsidian-vim-scrolling) that adds plain `d`/`u` half-page scrolling, an `f` link hint mode, and pop-out window support. Published with the original author's approval — see [Credits](#credits).

## Design Idea

Obsidian's built-in vim key bindings (powered by CodeMirror's vim mode) are active in source and live preview modes — but **reading mode** renders static HTML with no editor, so vim navigation keys (`j`, `k`, `Ctrl+D`, `Ctrl+U`, `gg`, `G`) do nothing there.

This plugin fills that gap: it intercepts those keystrokes in reading mode and scrolls the viewport directly, giving you consistent vim muscle memory regardless of which mode you are in.

It also handles a common friction point: after scrolling in reading mode, switching back to source mode may leave the cursor far from the visible content. The plugin corrects the cursor position so it matches what you were reading.

## Key Mappings

| Key            | Action                                          |
| -------------- | ----------------------------------------------- |
| `j`            | Scroll down one line                            |
| `k`            | Scroll up one line                              |
| `Ctrl+D` / `d` | Scroll down half a page                         |
| `Ctrl+U` / `u` | Scroll up half a page                           |
| `gg`           | Scroll to the top of the document               |
| `G`            | Scroll to the bottom of the document            |
| `f`            | Enter link hint mode — label every visible link |

In link hint mode, type a hint label to select a link. Internal links receive focus and show Obsidian's hover preview; press `Enter` to follow them or `Esc` to cancel. External links open immediately in the system default browser.

Keys are only active when:

1. The current view is in **reading mode** (preview)
2. Obsidian's **vim mode** is enabled (Settings → Editor → Vim key bindings)

## Design Details

### No Animation

Scrolling is instant — `scrollTop` is set directly with no CSS smooth-scroll or animation. This is intentional:

- Key-repeat events (holding `j` or `k`) scroll continuously without animation queuing lag.
- The behaviour matches source mode vim motions, which are also instantaneous.

### Repeated Key Strokes

Holding a key (e.g., `j`) produces repeated `keydown` events. Each event is handled independently — no debouncing or rate-limiting is applied — so the viewport scrolls smoothly as long as the key is held.

### Link Hint Mode

Pressing `f` enumerates every link currently visible in the viewport and overlays a short hint label on each — recreating the feel of the [Vimium](https://github.com/philc/vimium) browser extension for Chrome. Selecting a hint behaves according to the link type:

- **Internal links** → the link is highlighted, scrolled into view, and Obsidian's page preview popover is shown (requires the **Page Preview** core plugin).
- **External links** → the URL opens immediately in the system default browser.

With an internal link focused, `Enter` navigates via `openLinkText` and `Esc` clears the focus. Hints are dismissed automatically if you scroll, resize, switch panes, or toggle out of reading mode.

> [!NOTE]
> The hover preview's lifetime is controlled by the **Page Preview** core plugin, which re-evaluates hover state from the *physical* mouse pointer. If the pointer is stationary the popover stays open; any mouse movement (or content shifting under the pointer after the focus scroll) makes Page Preview notice the link is not actually hovered and dismiss it. This is core-plugin behavior, not something this plugin controls. If you want pinnable, persistent previews, the [Hover Editor](https://github.com/nothingislost/obsidian-hover-editor) plugin works well alongside this one.

### `gg` Detection

The `gg` command is triggered by pressing `g` twice within **500 ms**. After the first `g`, the timer starts. If a second `g` arrives within the window, the view scrolls to the top.

### Cursor Adjustment (Reading → Source Mode)

When you switch from reading mode to source mode, the CodeMirror editor restores the cursor to its last known position, which may no longer be visible (because you scrolled in reading mode). The plugin corrects this after the editor initialises:

- **Cursor is outside the visible viewport** (above or below) → cursor is moved to the **first editable line** of the current viewport.
- **Cursor is within the viewport** → cursor is left **unchanged**.

This ensures the editor opens with the cursor near the content you were reading.

## Usage

1. Enable **vim key bindings** in Obsidian: **Settings → Editor → Vim key bindings**
2. Install and enable this plugin.
3. Open any note and switch to **Reading mode** (the book icon in the top-right, or via the command palette).
4. Use `j`/`k`, `Ctrl+D`/`Ctrl+U`, `gg`, and `G` to navigate.

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
- An `f` Vimium-style link hint mode with hover preview and link activation
- Pop-out window support

Published to the community plugin directory with the original author's [explicit approval](https://github.com/xlongfeng/obsidian-vim-scrolling/issues/2#issuecomment-5088284571), per Obsidian's [fork policy](https://docs.obsidian.md/Developer+policies#Forks).

Distributed under the same [0BSD license](LICENSE) as the original.
