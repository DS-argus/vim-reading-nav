# Vim Reading Navigation

Navigate, search, scroll, preview, open links, and focus on what you read in Obsidian's **Reading mode** without leaving the keyboard.

> [!NOTE]
> Obsidian's **Vim key bindings** setting is not required.

> A fork of [xlongfeng/obsidian-vim-scrolling](https://github.com/xlongfeng/obsidian-vim-scrolling) that adds plain `d`/`u` half-page scrolling, `/` native search, an `f` link hint mode, persistent link previews, and pop-out window support. Published with the original author's approval — see [Credits](#credits).

## Features

- Vim-style instant scrolling in Reading mode, including key repeat
- [Link previews](#link-previews) with Vimium-style `f` hints for visible links
- [Heading folds](#heading-folds) with Vimium-style `F` hints for visible heading sections
- Persistent, mouse-independent Markdown previews for internal links and standard or inline footnotes
- Local external-link destination confirmation before opening in the system browser
- Cursor correction when switching from Reading mode back to the editor
- Native in-document search from Reading mode with `/`
- Main-window and pop-out-window support
- [Reading focus](#reading-focus) with `z` or a native pane-header toggle, adjustable opacity, and configurable context blocks

## Key mappings

### Built-in bare mappings

| Context                   | Key                   | Action                                               |
| ------------------------- | --------------------- | ---------------------------------------------------- |
| Reading mode              | `j` / `k`             | Scroll down / up                                     |
| Reading mode              | `d` / `u`             | Scroll down / up half a page                         |
| Reading mode              | `gg` / `G`            | Scroll to the top / bottom                           |
| Reading mode              | `f`                   | Show hints for visible links                         |
| Reading mode              | `F` (`Shift+F`)       | Show fold hints for visible headings                 |
| Reading mode              | `/`                   | Open Obsidian's native in-document search            |
| Reading mode              | `z`                   | Toggle reading focus                                 |
| Link hint mode            | Hint characters       | Select a link                                        |
| Heading hint mode         | Hint characters       | Toggle the selected heading section                  |
| Focused preview           | `Shift+J` / `Shift+K` | Scroll the preview down / up                         |
| Focused standard footnote | `Enter`               | Jump to its definition and close the preview         |
| Focused inline footnote   | `Enter`               | Keep the preview open; do not navigate               |
| Focused internal link     | `Enter`               | Follow the link and close the preview                |
| Focused external link     | `Enter`               | Open the confirmed destination in the system browser |
| Hint or preview mode      | `Esc`                 | Cancel and close                                     |

### Configurable page-scroll bindings

| Key                          | Action                         |
| ---------------------------- | ------------------------------ |
| `Ctrl+D` (default)           | Scroll down half a page        |
| `Ctrl+U` (default)           | Scroll up half a page          |
| Not set (suggested `Ctrl+F`) | Scroll down one Vim-style page |
| Not set (suggested `Ctrl+B`) | Scroll up one Vim-style page   |

Configure these Reading-mode bindings under **Settings → Vim Reading Navigation**, not Obsidian Hotkeys. Editor bindings are unaffected.

The settings page groups controls into **Scrolling**, **Reading focus**, and **Links and previews**. Existing saved preferences are retained when defaults change.

> On Windows and Linux, assigning `Ctrl+F` overrides in-note search in Reading mode.

Built-in bare mappings and configurable page-scroll bindings are active only while the current Markdown view is in **Reading mode**, and they are ignored in inputs, editors, and modals. Lowercase `j`/`k` continue to scroll the note while an internal-link preview is open.

Press `/` in Reading mode to open Obsidian's native in-document search. Search remains live while typing; use `Enter` and `Shift+Enter` for the next and previous result. `n` and `N` are intentionally not remapped while the native search field has focus.

## Link previews

Press `f`, then type the label beside a link to preview it. Notes, headings, blocks, and footnotes are supported. External links show their destination URL without fetching the page.

| Key after selecting a link | Action                                                                  |
| -------------------------- | ----------------------------------------------------------------------- |
| `Enter`                    | Open the link; jump to a standard footnote (inline footnotes stay open) |
| `Shift+J` / `Shift+K`      | Scroll the preview; lowercase `j/k` scroll the note                     |
| `Esc`                      | Close the preview                                                       |

### Split opening (optional)

**Enable split opening** under **Settings → Vim Reading Navigation** is on by default. Select a Markdown link, then:

| Direction | Open beside the note | Always create a new split |
| --------- | -------------------- | ------------------------- |
| Right     | `v`, then `Enter`    | `V`, then `Enter`         |
| Below     | `h`, then `Enter`    | `H`, then `Enter`         |

Lowercase reuses an adjacent pane whose shared edge matches the source, adding a new tab; otherwise it creates a split. The destination opens in Reading mode, including heading/block links. Confirm within **3 seconds**; after that, `Enter` opens in the current tab.

- **Show preview opening guidance:** on by default; disabled and hidden while split opening is off.
- **Open external links immediately:** off by default; enable to skip URL confirmation.

Non-Markdown files open normally but have no preview or split shortcut. Links inside embedded notes, tags, and `obsidian://` links are excluded. Preview content is display-only.

## Heading folds

Press `Shift+F` in Reading mode, then type the orange label beside a visible heading to collapse or expand its section using Obsidian's native heading folding. A collapsed heading remains visible with its fold indicator. Sections include nested lower-level headings and stop at the next heading of the same or higher level.

### Custom hint colors

The default link and heading hint colors follow Obsidian theme variables. Override them with a CSS snippet:

```css
.vim-reading-nav-hint {
  color: var(--text-on-accent);
  background-color: var(--interactive-accent);
}

.vim-reading-nav-heading-hint {
  background-color: var(--color-orange);
}
```

## Reading focus

Keep the passage you are reading bright while dimming surrounding text, without hiding the workspace or changing your pane layout.

### Toggle and status

- Press `z` in Reading mode, click the **focus icon in the pane header**, or run **Vim Reading Navigation: Toggle reading focus** from the command palette.
- The header icon is highlighted while enabled, and a brief Obsidian notice confirms each toggle. The icon supports keyboard activation with Enter or Space.
- If your theme or settings hide the pane header, use `z` or the command; toggle notices still appear.
- Holding `z` does not toggle repeatedly. Inputs, modals, editors, and active link-hint input are left alone. Additional command shortcuts can be assigned under **Settings → Hotkeys**.

**Focus follows the active Reading pane.** Switching panes removes the effect from the previous pane and applies it to the newly active Reading pane. The enabled state is shared within the vault session, not stored independently for each pane. Other panes, link-hint overlays, and separate preview popups retain their appearance. Editing and non-Markdown views have no focus effect; returning to a Reading pane resumes it while enabled.

### Focus range

The block nearest the viewport center and its surrounding context stay bright. Near the start or end of a note, the focus anchor moves toward that edge so the first and last blocks remain reachable. Notes that fit without scrolling stay fully bright. Scroll, resize, image loading, and rerendering update the focused passage automatically.

Configure **Settings → Vim Reading Navigation → Reading focus**:

| Option | Default | Range |
| --- | --- | --- |
| Surrounding text opacity | **50%** | 10–100%, in steps of 5; higher values keep surrounding text clearer |
| Context blocks on each side | **2** | 0–5 blocks before and after the selected block |

The default highlights **up to 5 blocks**: the selected block plus 2 on each side. Set the context to 0 for only the selected block, or 5 for up to 11 blocks. At 100% opacity, surrounding text is not visibly dimmed, but focus remains enabled.

Both options are saved and applied immediately. **Focus starts off after each plugin load**; its enabled state is not saved. Existing saved preferences are retained when defaults change.

### Block boundaries and limitations

Paragraphs, headings, lists, tables, code blocks, blockquotes, and similar top-level rendered blocks are supported. A long list, table, code block, or embed is treated as a single block, so a large block can keep most of the viewport bright. Nested elements are not dimmed again.

Only mounted top-level `el-*` wrappers directly inside `.markdown-preview-sizer` are considered; unsupported renderer layouts are left unchanged, and offscreen content is not materialized. This is a reading-focus feature, not a Zen mode that hides workspace UI.

## Usage

1. Open a Markdown note in **Reading mode**.
2. Use the built-in mappings above, configure page-scroll bindings in **Settings → Vim Reading Navigation**, or press `f` to select links.
3. Press `z` or click the focus icon in the pane header to enable reading focus. Adjust its opacity and context range under **Settings → Vim Reading Navigation → Reading focus**.

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

- Plain `d` / `u` half-page scrolling
- Configurable Reading-mode page-scroll bindings
- An `f` Vimium-style link hint mode with persistent previews and link activation
- Pop-out window support
- `/` shortcut for Obsidian's native in-document search
- Footnote previews
- External destination confirmation

Published to the community plugin directory with the original author's [explicit approval](https://github.com/xlongfeng/obsidian-vim-scrolling/issues/2#issuecomment-5088284571), per Obsidian's [fork policy](https://docs.obsidian.md/Developer+policies#Forks).

Distributed under the same [0BSD license](LICENSE) as the original.
