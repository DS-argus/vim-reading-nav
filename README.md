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

| Key | Action |
| --- | --- |
| `j` / `k` | Scroll down / up |
| `d` / `u` | Scroll half a page down / up |
| `gg` / `G` | Jump to the top / bottom |
| `f` | Show hints for links and top-level Markdown embeds |
| `F` (`Shift+F`) | Show heading-fold hints |
| `/` | Open Obsidian's in-note search |
| `z` | Toggle reading focus |

Mappings apply only in Reading mode and leave inputs, editors, and modals alone. Switching back to the editor also adjusts the cursor to the reading position.

### Page-scroll bindings

Configure these in **Settings → Vim Reading Navigation**, not Obsidian Hotkeys.

| Action | Default |
| --- | --- |
| Half page down / up | `Ctrl+D` / `Ctrl+U` |
| Full page down / up | Unassigned |

Editor bindings are unaffected. On Windows and Linux, assigning `Ctrl+F` overrides in-note search in Reading mode.

In search, use `Enter` / `Shift+Enter` for the next / previous result.

## Link previews

Press `f`, then type a hint label to select a link or Markdown embed.

Supported targets include notes, headings, blocks, footnotes, external web links, and top-level Markdown embeds. Embed hints appear beside the native open icon. Links inside embeds and non-Markdown embeds are excluded.

| Key after selection | Action |
| --- | --- |
| `Enter` | Open the target |
| `Shift+J` / `Shift+K` | Scroll the preview |
| `j` / `k` | Scroll the note |
| `Esc` | Close the preview or cancel hints |

Standard footnotes jump to their definitions; inline footnotes are preview-only. Other non-Markdown file links open normally without a preview.

External links show a URL confirmation before opening. Enable **Open external links immediately** to skip confirmation.

### Split opening

Select a Markdown link or embed, then press a direction key followed by `Enter`:

| Direction | Reuse an adjacent pane when possible | Always create a new split |
| --- | --- | --- |
| Right | `v` → `Enter` | `V` → `Enter` |
| Below | `h` → `Enter` | `H` → `Enter` |

Reusing a pane adds a new tab rather than replacing its current note. Destinations open in Reading mode and preserve heading/block targets.

Confirm within **3 seconds**; otherwise, `Enter` opens in the current tab. Split opening and its preview guidance are enabled by default and can be disabled in settings.

## Heading folds

Press `F`, then type the label beside a visible heading to fold or unfold its section. The heading stays visible; its section includes nested headings up to the next heading of equal or higher level.

## Reading focus

Press `z`, click the pane-header focus icon, or run **Toggle reading focus** from the command palette.

The passage near the viewport center stays bright while surrounding text dims. Focus follows the active Reading pane without hiding the workspace.

Configure **Settings → Vim Reading Navigation → Reading focus**:

| Setting | Default | Range |
| --- | --- | --- |
| Surrounding text opacity | 50% | 10–100% |
| Context blocks on each side | 2 | 0–5 |

Lists, tables, code blocks, and embeds are treated as whole blocks, so large blocks may keep much of the screen bright.

Preferences are saved, but focus starts off each time the plugin loads.

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
