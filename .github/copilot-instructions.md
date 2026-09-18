# Copilot Instructions

## Build & lint commands

```bash
npm install          # install dependencies
npm run dev          # watch mode — compiles src/main.ts → main.js with inline sourcemaps
npm run build        # production build — runs tsc type-check, then esbuild (minified, no sourcemaps)
npm run lint         # run eslint across the project (includes eslint-plugin-obsidianmd)
npm test             # focused split/session regressions using Node's test runner
npm version patch    # bump version in manifest.json, package.json, versions.json (after manually updating minAppVersion)
```

`npm test` runs deterministic split/session regression checks with mocked Obsidian host APIs; it does not replace real-app testing. CI runs `npm run build` and `npm run lint` on Node 20 and 22.

## Architecture

This is an **Obsidian community plugin** built with TypeScript + esbuild.

- **Entry point**: `src/main.ts` — exports a default class extending `Plugin`. This is the only file esbuild uses as an entry point.
- **Output**: `main.js` at the repo root (CJS format, ES2018 target). This file, along with `manifest.json` and `styles.css`, is what Obsidian loads.
- **Source**: all TypeScript lives under `src/`. `tsconfig.json` sets `baseUrl: "src"`, so imports within `src/` resolve relative to that directory.
- **Settings**: the plugin currently has no settings. If settings are added, create `src/settings.ts` with the settings interface, `DEFAULT_SETTINGS` constant, and the `PluginSettingTab` subclass, and wire them up in `main.ts`.

### esbuild externals

The following packages are **not** bundled — they are provided at runtime by Obsidian/Electron and must be imported normally:

```
obsidian, electron,
@codemirror/autocomplete, @codemirror/collab, @codemirror/commands,
@codemirror/language, @codemirror/lint, @codemirror/search,
@codemirror/state, @codemirror/view,
@lezer/common, @lezer/highlight, @lezer/lr
```

All other `npm` dependencies **are** bundled into `main.js`.

## Key conventions

### Listener registration — always use `this.register*`

Use the provided helpers so Obsidian automatically cleans up when the plugin is disabled:

```ts
this.registerEvent(this.app.workspace.on("file-open", handler));
this.registerDomEvent(document, "click", handler);
this.registerInterval(window.setInterval(fn, 5000));
```

Never attach raw `addEventListener` or `setInterval` calls without a corresponding cleanup.

### Settings pattern

```ts
// settings.ts
export interface MyPluginSettings { mySetting: string }
export const DEFAULT_SETTINGS: MyPluginSettings = { mySetting: "default" }

// main.ts — load/save
async loadSettings() {
  this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MyPluginSettings>);
}
async saveSettings() { await this.saveData(this.settings); }
```

Settings are persisted via `this.loadData()` / `this.saveData()` (Obsidian's built-in JSON storage).

### Command IDs are stable API

Once a command `id` is shipped, never rename it — it breaks user hotkey bindings.

### TypeScript strictness

`tsconfig.json` enables `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, and `isolatedModules`. All code must satisfy these without `// @ts-ignore`.

### File size limit

If any file exceeds ~200–300 lines, split it into focused modules. `src/main.ts` should stay minimal (lifecycle only: `onload`, `onunload`, `addCommand`, `addSettingTab`).

## Releases

1. Manually update `minAppVersion` in `manifest.json` if needed.
2. Run `npm version patch|minor|major` — updates `manifest.json`, `package.json`, and `versions.json`.
3. Create a GitHub release whose tag **exactly** matches `manifest.json`'s `version` field (no leading `v`).
4. Attach `main.js`, `manifest.json`, and `styles.css` as release assets.

## Manual testing in Obsidian

Copy `main.js`, `manifest.json`, and `styles.css` to:
```
<Vault>/.obsidian/plugins/<plugin-id>/
```
Then reload Obsidian and enable the plugin under **Settings → Community plugins**.
