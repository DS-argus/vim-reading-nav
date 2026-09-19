import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

const result = await build({
	stdin: { contents: `export * from './src/viewUtils';
		export { ReadingModeScrollHandler } from './src/scrollHandler';`, resolveDir: process.cwd() },
	bundle: true, write: false, format: 'esm', platform: 'node',
	plugins: [{ name: 'obsidian-host', setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
		build.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents:
			'export class MarkdownView {} export class PluginSettingTab {} export class Setting {} export class Component {} export class Notice {} export const Platform = {}; export function setIcon() {}' }));
	} }],
});
const { getScrollElement, getPreviewViewIn, ReadingModeScrollHandler } = await import(
	`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`,
);

function fixture(contents = '') {
	const { document } = parseHTML(`<html><body><div id="pane">
		<div class="markdown-source-view" hidden><div id="hidden-embed" class="markdown-preview-view"></div></div>
		<div class="markdown-reading-view"><div id="reading" class="markdown-preview-view">${contents}</div></div>
	</div></body></html>`);
	const view = { containerEl: document.querySelector('#pane'), getMode: () => 'preview' };
	return { document, view, reading: document.querySelector('#reading'), hidden: document.querySelector('#hidden-embed') };
}

for (const [name, contents] of [
	['plain note', '<p>Plain text</p>'],
	['full note embed', '<div class="markdown-embed"><div class="markdown-preview-view"><p>Note</p></div></div>'],
	['heading embed', '<div class="markdown-embed"><div class="markdown-preview-view"><h2>Heading</h2></div></div>'],
	['block embed', '<div class="markdown-embed"><div class="markdown-preview-view"><p id="block">Block</p></div></div>'],
	['nested and multiple embeds', '<div class="markdown-embed"><div class="markdown-preview-view"><div class="markdown-preview-view"></div></div></div><div class="markdown-preview-view"></div>'],
	['media and viewers', '<img src="missing.png"><audio controls></audio><video controls></video><object type="application/pdf"></object><iframe></iframe>'],
	['unresolved embed', '<div class="internal-embed is-unresolved"></div>'],
]) {
	test(`selects outer reading root with ${name}`, () => {
		const { view, reading, hidden } = fixture(contents);
		assert.equal(view.containerEl.querySelector('.markdown-preview-view'), hidden);
		assert.ok(getScrollElement(view) === reading);
	});
}

test('does not fall back to hidden embeds without a reading root', () => {
	const { view, reading } = fixture();
	reading.remove();
	assert.ok(getScrollElement(view) === null);
	view.containerEl.querySelector('.markdown-reading-view').remove();
	assert.ok(getScrollElement(view) === null);
});

test('limits selection to the requested pane', () => {
	const { document, view, reading } = fixture();
	const other = document.createElement('div');
	other.innerHTML = '<div class="markdown-reading-view"><div class="markdown-preview-view"></div></div>';
	document.body.prepend(other);
	assert.ok(getScrollElement(view) === reading);
	assert.notEqual(getScrollElement(view), other.querySelector('.markdown-preview-view'));
});

test('resolves a fresh root after reading mode rerenders', () => {
	const { view, reading } = fixture();
	const replacement = reading.cloneNode(true);
	reading.replaceWith(replacement);
	assert.ok(getScrollElement(view) === replacement);
});

test('keeps document and reading-mode guards for separate windows', () => {
	const first = fixture();
	const second = fixture();
	const app = { workspace: { getActiveViewOfType: () => second.view } };
	assert.equal(getPreviewViewIn(app, first.document), null);
	assert.equal(getPreviewViewIn(app, second.document), second.view);
	assert.ok(getScrollElement(second.view) === second.reading);
	second.view.getMode = () => 'source';
	assert.equal(getPreviewViewIn(app, second.document), null);
});

test('j/k change the reading root without scrolling a hidden embed', () => {
	const { document, view, reading, hidden } = fixture();
	const callbacks = [];
	const plugin = {
		app: { workspace: { getActiveViewOfType: () => view } },
		registerDomEvent: (_doc, _type, callback) => callbacks.push(callback),
	};
	const handler = new ReadingModeScrollHandler(plugin, {});
	handler.registerTo(document);
	reading.scrollTop = 100;
	hidden.scrollTop = 50;
	// Obsidian adds these cross-window helpers to real key events and nodes.
	const previous = globalThis.HTMLElement;
	globalThis.HTMLElement = document.defaultView.HTMLElement;
	reading.instanceOf = constructor => reading instanceof constructor;
	try {
		let prevented = 0;
		const press = key => callbacks[1]({ key, targetNode: reading, preventDefault() { prevented++; } });
		press('j');
		assert.equal(reading.scrollTop, 124);
		assert.equal(hidden.scrollTop, 50);
		press('k');
		assert.equal(reading.scrollTop, 100);
		assert.equal(hidden.scrollTop, 50);
		assert.equal(prevented, 2);
	} finally {
		if (previous === undefined) delete globalThis.HTMLElement;
		else globalThis.HTMLElement = previous;
	}
});
