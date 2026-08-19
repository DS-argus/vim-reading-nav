# Contributing to Vim Reading Navigation

Thank you for considering contributing! This document covers everything you need to get started.

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or 22 (LTS)
- npm (comes with Node.js)
- [Obsidian](https://obsidian.md/) for manual testing

## Setting up the development environment

```bash
git clone https://github.com/DS-argus/vim-reading-nav
cd vim-reading-nav
npm install
```

## Development workflow

### Watch mode (recommended during development)

```bash
npm run dev
```

This compiles `src/main.ts` → `main.js` with inline source maps and rebuilds on every file change.

### Production build

```bash
npm run build
```

Runs a TypeScript type-check (`tsc -noEmit`) followed by a minified esbuild bundle. The build must pass before opening a pull request.

### Lint

```bash
npm run lint
```

Uses ESLint with [`eslint-plugin-obsidianmd`](https://github.com/obsidianmd/eslint-plugin-obsidianmd). Fix all lint errors before opening a pull request.

## Project structure

```
src/
  main.ts          # Plugin entry point — lifecycle only (onload, onunload)
  scrollHandler.ts   # Keydown listener and vim scroll commands for reading mode
  linkHintHandler.ts # Vimium-style link hint mode (f) with persistent previews
  cursorManager.ts   # Cursor correction when switching reading → source mode
  viewUtils.ts     # Shared guards/lookups (modal focus, reading view, scroll element)
  types.ts         # Shared TypeScript interfaces
esbuild.config.mjs # Bundle configuration
eslint.config.mts  # Lint configuration
manifest.json      # Obsidian plugin manifest
versions.json      # Plugin version → minimum Obsidian version map
```

## Manual testing in Obsidian

1. Run `npm run dev` to start watch mode.
2. Copy (or symlink) the plugin folder into your vault:
   ```
   <Vault>/.obsidian/plugins/vim-reading-nav/
   ```
   The folder must contain `main.js`, `manifest.json`, and `styles.css`.
3. In Obsidian, enable **Settings → Community plugins → Vim Reading Navigation**.
4. Open a note in **Reading mode** and exercise the key mappings (`j`, `k`, `d`/`Ctrl+D`, `u`/`Ctrl+U`, `gg`, `G`, `f`, `Shift+J`/`Shift+K`).

## Coding conventions

- TypeScript strict mode is enforced (`noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, `isolatedModules`). All code must satisfy these without `// @ts-ignore`.
- Keep `src/main.ts` minimal — plugin lifecycle only. Feature logic belongs in dedicated modules.
- Split any file that grows beyond ~200–300 lines.
- Use Obsidian's `this.register*` helpers for all event listeners and intervals so they are cleaned up automatically on plugin disable.
- Use `activeDocument` instead of `document` and `activeWindow` instead of `window` for popout window compatibility.
- Command `id` values are stable API — never rename them once released.

## Submitting a pull request

1. Fork the repository and create a feature branch from `master`.
2. Make your changes; ensure `npm run build` and `npm run lint` both pass.
3. Write a clear commit message describing *what* and *why*.
4. Open a pull request against `master` with a description of the change and any relevant context.

## Releasing (maintainers only)

1. Update `minAppVersion` in `manifest.json` if any new Obsidian API is used.
2. Run `npm version patch|minor|major` — this bumps `manifest.json`, `package.json`, and `versions.json` and stages the changes.
3. Push the version commit and the new tag:
   ```bash
   git push && git push --tags
   ```
4. The release workflow (`.github/workflows/release.yml`) will build, attest, and publish the GitHub release automatically.

## License

By contributing, you agree that your contributions will be licensed under the [0-BSD License](LICENSE).
