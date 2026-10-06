import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

// The four hint modes wired together the way main.ts wires them, with the
// scroll handler behind them, to check which handler each key reaches.
const result = await build({
	stdin: { contents: `
		export { LinkHintHandler } from './src/linkHintHandler';
		export { HeadingFoldHintHandler } from './src/headingFoldHintHandler';
		export { CodeCopyHintHandler } from './src/codeCopyHintHandler';
		export { ReadingModeScrollHandler } from './src/scrollHandler';
		export { generateHintLabels, HintModes, readHintKey } from './src/hintModes';
		export { MarkdownView } from 'obsidian';
	`, resolveDir: process.cwd() },
	bundle: true, write: false, format: 'esm', platform: 'node',
	plugins: [{ name: 'host-mocks', setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
		build.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: `
			export class MarkdownView { getMode() { return 'preview'; } }
			export class WorkspaceTabs {}
			export class Component {}
			export class TFile { constructor(path) { this.path = path; this.extension = 'md'; } }
			export function parseLinktext(text) { return { path: text, subpath: '' }; }
			export function resolveSubpath() { return null; }
		` }));
		build.onResolve({ filter: /^\.\/(persistentLinkPreview|footnoteResolver|settings)$/ }, (args) => ({ path: args.path, namespace: 'mock' }));
		build.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: {
			'./persistentLinkPreview': `export class PersistentLinkPreview {
				setGuidance() {} reposition() {} close() { this.opened = false; }
				open() { this.opened = true; } openExternal() { this.opened = true; } isOpen() { return this.opened; }
			}`,
			'./footnoteResolver': 'export class FootnoteResolver { register() {} get() { return null; } }',
			'./settings': 'export function bindingMatchesEvent() { return false; }',
		}[path] }));
	} }],
});
const {
	LinkHintHandler, HeadingFoldHintHandler, CodeCopyHintHandler, ReadingModeScrollHandler,
	generateHintLabels, HintModes, readHintKey, MarkdownView,
} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

function rect(left, top, width, height) {
	return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON() {} };
}

function setRect(element, value) {
	Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: () => value });
	return element;
}

const LINE = 20;

/**
 * Links l0..l(n-1), headings h0..h(n-1), code blocks b0..b(n-1) and inline
 * code c0..c(n-1), laid out 30px apart.
 */
function setup({ links = 0, headings = 0, blocks = 0, inline = 0 } = {}) {
	const parts = ['<div><p>intro</p></div>'];
	for (let i = 0; i < headings; i++) parts.push(`<div><h2 id="h${i}">Heading ${i}<span class="heading-collapse-indicator"></span></h2></div>`);
	for (let i = 0; i < links; i++) parts.push(`<div><p><a id="l${i}" href="https://example.test/${i}">link ${i}</a></p></div>`);
	for (let i = 0; i < blocks; i++) parts.push(`<div><pre id="b${i}"><code>block ${i}</code><button class="copy-code-button"></button></pre></div>`);
	for (let i = 0; i < inline; i++) parts.push(`<div><p><code id="c${i}">inline ${i}</code></p></div>`);
	const { document } = parseHTML(`<html><body><div id="pane"><div class="markdown-reading-view"><div id="scroll" class="markdown-preview-view"><div class="markdown-preview-sizer">${parts.join('')}</div></div></div></div></body></html>`);
	const win = document.defaultView;
	const proto = win.HTMLElement.prototype;
	proto.addClass ??= function (name) { this.classList.add(name); };
	proto.removeClass ??= function (name) { this.classList.remove(name); };
	proto.toggleClass ??= function (name, force) { this.classList.toggle(name, force); };
	proto.instanceOf ??= function (constructor) { return this instanceof constructor; };
	proto.scrollIntoView ??= function () {};
	win.getComputedStyle = () => ({ overflowX: 'visible', overflowY: 'visible', lineHeight: `${LINE}px` });
	document.body.createSpan = ({ cls, text }) => {
		const span = document.createElement('span');
		span.className = cls;
		span.textContent = text;
		document.body.append(span);
		return span;
	};
	const scroll = setRect(document.querySelector('#scroll'), rect(0, 0, 600, 2000));
	Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 400 });
	Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 5000 });
	scroll.scrollTop = 0;
	let top = 10;
	for (const el of document.querySelectorAll('h2, a, pre, p > code')) {
		setRect(el, rect(10, top, 200, LINE));
		if (el.matches('p > code')) Object.defineProperty(el, 'getClientRects', { configurable: true, value: () => [rect(10, top, 200, LINE)] });
		top += 30;
	}
	for (const p of document.querySelectorAll('p')) setRect(p, rect(10, 0, 200, LINE));

	const folds = [];
	for (const heading of document.querySelectorAll('h2')) {
		heading.querySelector('.heading-collapse-indicator').addEventListener('click', () => folds.push(heading.id));
	}
	const copies = [];
	for (const pre of document.querySelectorAll('pre')) {
		pre.querySelector('button').addEventListener('click', () => copies.push(pre.id));
	}
	Object.defineProperty(globalThis.navigator, 'clipboard', {
		configurable: true,
		value: { writeText: async (text) => { copies.push(text); } },
	});

	const view = Object.assign(new MarkdownView(), { containerEl: document.querySelector('#pane'), file: { path: 'source.md' }, previewMode: { rerender() {} } });
	const listeners = [];
	const windowCapture = [];
	const plugin = {
		app: {
			workspace: { on() { return {}; }, getActiveViewOfType: () => view, iterateAllLeaves() {} },
			vault: { getAbstractFileByPath: () => null },
			metadataCache: { getFirstLinkpathDest: () => null, getFileCache: () => null },
		},
		settings: { enableSplitOpening: true, showPreviewOpeningGuidance: true, openExternalLinksImmediately: false },
		registerDomEvent(target, type, callback, options) {
			if (type !== 'keydown') return;
			if (target === win && options === true) windowCapture.push(callback);
			else if (options !== true) listeners.push(callback);
		},
		registerEvent() {},
		register() {},
	};
	const modes = new HintModes();
	const linkHints = new LinkHintHandler(plugin, modes);
	const headingHints = new HeadingFoldHintHandler(plugin, modes);
	const codeHints = new CodeCopyHintHandler(plugin, modes);
	modes.registerTo(plugin, document);
	// Same order as main.ts registerForDocument.
	linkHints.registerTo(document);
	headingHints.registerTo(document);
	codeHints.registerTo(document);
	new ReadingModeScrollHandler(plugin, plugin.settings).registerTo(document);

	const press = (key, options = {}) => {
		const event = {
			key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...options,
			targetNode: document.body,
			defaultPrevented: false,
			stopped: false,
			preventDefault() { this.defaultPrevented = true; },
			stopImmediatePropagation() { this.stopped = true; },
		};
		const previous = globalThis.HTMLElement;
		globalThis.HTMLElement = win.HTMLElement;
		try {
			for (const listener of windowCapture) listener(event);
			// Obsidian's own hotkeys (Cmd+P, Cmd+O, ...) stop the event on the window.
			if (options.hotkey) return event;
			for (const listener of listeners) {
				listener(event);
				if (event.stopped) break;
			}
		} finally {
			if (previous === undefined) delete globalThis.HTMLElement;
			else globalThis.HTMLElement = previous;
		}
		return event;
	};
	const shift = (key) => {
		press('Shift', { shiftKey: true });
		return press(key, { shiftKey: true });
	};
	const labels = (cls) => [...document.querySelectorAll(cls)].map((hint) => hint.textContent);
	const active = () => ({
		f: linkHints.isActive(document),
		F: headingHints.isActive(document),
		code: codeHints.isActive(document),
	});
	return {
		document, scroll, press, shift, folds, copies, active,
		linkLabels: () => labels('.vim-reading-nav-hint:not(.vim-reading-nav-heading-hint):not(.vim-reading-nav-code-hint):not(.vim-reading-nav-inline-code-hint)'),
		headingLabels: () => labels('.vim-reading-nav-heading-hint'),
		blockLabels: () => labels('.vim-reading-nav-code-hint'),
		inlineLabels: () => labels('.vim-reading-nav-inline-code-hint'),
		allHints: () => labels('.vim-reading-nav-hint'),
		focusedLinks: () => document.querySelectorAll('.vim-reading-nav-link-focused').length,
	};
}

const NONE = { f: false, F: false, code: false };

test('labels are lowercase-only, home-row first, and never use f or y', () => {
	assert.deepEqual(generateHintLabels(4), ['a', 's', 'd', 'g']);
	assert.deepEqual(generateHintLabels(0), []);
	const single = generateHintLabels(24);
	assert.equal(single.length, 24);
	assert.equal(new Set(single).size, 24);
	const double = generateHintLabels(25);
	assert.deepEqual(double.slice(0, 3), ['aa', 'as', 'ad']);
	assert.equal(generateHintLabels(24 * 24).length, 24 * 24);
	for (const label of [...single, ...generateHintLabels(24 * 24)]) {
		assert.match(label, /^[a-z]+$/);
		assert.ok(!label.includes('f') && !label.includes('y'), label);
	}
});

test('readHintKey: labels, Backspace, held keys and bare modifiers; Ctrl/Cmd/Alt are shortcuts; the rest close', () => {
	const key = (k, extra = {}) => readHintKey({ key: k, ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...extra });
	assert.deepEqual(key('a'), { kind: 'label', char: 'a' });
	assert.deepEqual(key('j'), { kind: 'label', char: 'j' });
	assert.deepEqual(key('Backspace'), { kind: 'backspace' });
	assert.deepEqual(key('F', { repeat: true }), { kind: 'held' });
	assert.deepEqual(key('Shift'), { kind: 'modifier' });
	for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
		assert.deepEqual(key('a', { [modifier]: true }), { kind: 'shortcut' }, modifier);
	}
	for (const other of ['Escape', 'f', 'F', 'y', 'Y', 'A', 'G', '/', '1', 'Enter', 'ArrowDown']) {
		assert.deepEqual(key(other), { kind: 'close' }, other);
	}
});

for (const [trigger, setupArgs, labelsOf] of [
	['f', { links: 3 }, 'linkLabels'],
	['F', { headings: 3 }, 'headingLabels'],
	['y', { blocks: 3 }, 'blockLabels'],
	['Y', { inline: 3 }, 'inlineLabels'],
]) {
	test(`${trigger}: same key closes, a held key keeps hints, and labels skip f and y`, () => {
		const dom = setup(setupArgs);
		const press = trigger === trigger.toUpperCase() ? dom.shift : dom.press;
		assert.equal(press(trigger).defaultPrevented, true);
		assert.deepEqual(dom[labelsOf](), ['A', 'S', 'D']);
		assert.equal(dom.press(trigger, { repeat: true, shiftKey: trigger !== trigger.toLowerCase() }).defaultPrevented, true);
		assert.equal(dom[labelsOf]().length, 3, 'holding the trigger keeps hints');
		assert.equal(press(trigger).defaultPrevented, true);
		assert.deepEqual(dom.active(), NONE);
		assert.deepEqual(dom.allHints(), []);
		assert.deepEqual(dom.folds, []);
		assert.deepEqual(dom.copies, []);
		assert.equal(dom.focusedLinks(), 0);
	});
}

test('a physical Shift keydown inside F or Y hints keeps them open for Shift+F / Shift+Y', () => {
	const dom = setup({ headings: 2, inline: 2 });
	dom.shift('F');
	assert.equal(dom.press('Shift', { shiftKey: true }).defaultPrevented, false, 'a bare Shift is not consumed');
	assert.equal(dom.active().F, true);
	dom.press('F', { shiftKey: true });
	assert.deepEqual(dom.active(), NONE, 'Shift then F closes heading hints');
	dom.shift('Y');
	dom.shift('Y');
	assert.deepEqual(dom.active(), NONE);
	assert.deepEqual(dom.copies, []);
});

test('inside any hints, every hint key only closes them and opens nothing', () => {
	const dom = setup({ links: 2, headings: 2, blocks: 2, inline: 2 });
	const open = { f: () => dom.press('f'), F: () => dom.shift('F'), y: () => dom.press('y'), Y: () => dom.shift('Y') };
	for (const first of Object.keys(open)) for (const second of Object.keys(open)) {
		open[first]();
		assert.equal(dom.allHints().length, 2, `${first} opens its hints`);
		assert.equal(open[second]().defaultPrevented, true, `${second} is consumed inside ${first} hints`);
		assert.deepEqual(dom.active(), NONE, `${second} inside ${first} hints closes them`);
		assert.deepEqual(dom.allHints(), [], `${second} inside ${first} hints opens nothing`);
	}
	assert.deepEqual(dom.folds, []);
	assert.deepEqual(dom.copies, []);
	assert.equal(dom.focusedLinks(), 0);
});

test('other keys only close hints; Ctrl, Cmd and Alt shortcuts close them and still run', () => {
	const dom = setup({ blocks: 30 });
	dom.press('y');
	assert.equal(dom.blockLabels()[0], 'AA');
	const g = dom.shift('G');
	assert.deepEqual(dom.active(), NONE);
	assert.equal(g.stopped, true, 'G stops at the hints');
	assert.equal(dom.scroll.scrollTop, 0, 'G did not jump to the bottom');

	for (const key of ['/', 'Escape', 'Enter', '1']) {
		dom.press('y');
		assert.equal(dom.press(key).stopped, true, key);
		assert.deepEqual(dom.active(), NONE, key);
	}

	dom.press('y');
	const ctrl = dom.press('d', { ctrlKey: true });
	assert.deepEqual(dom.active(), NONE);
	assert.equal(ctrl.stopped, false, 'Ctrl+key is left to Obsidian and the configured scroll bindings');
	assert.deepEqual(dom.copies, []);
	dom.shift('G');
	assert.equal(dom.scroll.scrollTop, 5000, 'with no hints, G jumps to the bottom');
});

test('Obsidian hotkeys such as Cmd+P and Cmd+O close every kind of hints, and a focused link stays', () => {
	const dom = setup({ links: 2, headings: 2, blocks: 2, inline: 2 });
	const open = { f: () => dom.press('f'), F: () => dom.shift('F'), y: () => dom.press('y'), Y: () => dom.shift('Y') };
	for (const [name, openHints] of Object.entries(open)) {
		for (const hotkey of [{ key: 'p', metaKey: true }, { key: 'o', metaKey: true }, { key: 'p', ctrlKey: true }, { key: 'ArrowLeft', altKey: true }]) {
			openHints();
			assert.equal(dom.allHints().length, 2, `${name} opens its hints`);
			const event = dom.press(hotkey.key, { ...hotkey, hotkey: true });
			assert.deepEqual(dom.active(), NONE, `${JSON.stringify(hotkey)} closes ${name} hints`);
			assert.deepEqual(dom.allHints(), []);
			assert.equal(event.defaultPrevented, false, 'the hotkey itself is left to Obsidian');
		}
	}
	dom.press('Meta', { metaKey: true, hotkey: true });
	dom.press('f');
	assert.equal(dom.press('Meta', { metaKey: true }).defaultPrevented, false);
	assert.equal(dom.allHints().length, 2, 'a bare Cmd keydown keeps hints open for the next key');
	dom.press('s');
	assert.equal(dom.focusedLinks(), 1);
	dom.press('k', { metaKey: true, hotkey: true });
	assert.equal(dom.focusedLinks(), 1, 'a hotkey without hints leaves the focused link alone');
	dom.shift('F');
	dom.press('p', { metaKey: true, hotkey: true });
	assert.deepEqual(dom.active(), NONE);
	assert.equal(dom.focusedLinks(), 1, 'closing F hints over a focused link keeps the link');
	assert.deepEqual(dom.folds, []);
	assert.deepEqual(dom.copies, []);
});

test('j, k, d, u, g and z type labels while hints show, and keep their actions once hints close', () => {
	const dom = setup({ blocks: 6 });
	dom.press('y');
	assert.deepEqual(dom.blockLabels(), ['A', 'S', 'D', 'G', 'H', 'J']);
	assert.equal(dom.press('j').defaultPrevented, true);
	assert.equal(dom.scroll.scrollTop, 0, 'j typed a label instead of scrolling');
	assert.deepEqual(dom.copies, ['b5']);
	dom.press('y');
	dom.press('k');
	assert.deepEqual(dom.active(), NONE, 'k matches no label and closes');
	assert.equal(dom.scroll.scrollTop, 0);
	assert.deepEqual(dom.copies, ['b5']);
	dom.press('j');
	assert.equal(dom.scroll.scrollTop, LINE, 'with no hints, j scrolls');
});

test('a mismatched label closes hints without copying or folding', () => {
	const dom = setup({ headings: 2, blocks: 2 });
	dom.shift('F');
	dom.press('k');
	assert.deepEqual(dom.active(), NONE);
	dom.press('y');
	dom.press('z');
	assert.deepEqual(dom.active(), NONE);
	assert.deepEqual(dom.folds, []);
	assert.deepEqual(dom.copies, []);
});

test('label selection works in every mode, and F hints keep a focused link', () => {
	const dom = setup({ links: 2, headings: 2, blocks: 2, inline: 2 });
	dom.press('f');
	dom.press('s');
	assert.equal(dom.focusedLinks(), 1, 'f s focuses the second link');
	dom.shift('F');
	assert.equal(dom.focusedLinks(), 1, 'F hints keep the focused link');
	dom.press('s');
	assert.deepEqual(dom.folds, ['h1']);
	assert.equal(dom.focusedLinks(), 1);
	dom.press('Escape');
	assert.equal(dom.focusedLinks(), 0);
	dom.press('y');
	dom.press('a');
	dom.shift('Y');
	dom.press('s');
	assert.deepEqual(dom.copies, ['b0', 'inline 1']);
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('y on a focused link copies it and keeps the focus; after Esc, y opens code hints', async () => {
	const dom = setup({ links: 2, blocks: 2 });
	dom.press('f');
	dom.press('s');
	assert.equal(dom.press('y').defaultPrevented, true);
	assert.deepEqual(dom.active(), NONE, 'y on a focused link opens no code hints');
	await tick();
	assert.deepEqual(dom.copies, ['https://example.test/1']);
	assert.equal(dom.focusedLinks(), 1, 'the link stays focused');
	assert.ok(dom.document.querySelector('#l1').classList.contains('vim-reading-nav-copied'));
	assert.equal(dom.press('y', { repeat: true }).defaultPrevented, true);
	await tick();
	assert.equal(dom.copies.length, 1, 'holding y copies once');
	dom.press('Escape');
	assert.equal(dom.focusedLinks(), 0);
	dom.press('y');
	assert.deepEqual(dom.active(), { ...NONE, code: true }, 'with no focused link, y opens code block hints');
});

test('while F hints show over a focused link, y only closes them', async () => {
	const dom = setup({ links: 1, headings: 2 });
	dom.press('f');
	dom.press('a');
	dom.shift('F');
	assert.equal(dom.press('y').defaultPrevented, true);
	assert.deepEqual(dom.active(), NONE);
	await tick();
	assert.deepEqual(dom.copies, []);
	assert.equal(dom.focusedLinks(), 1);
});
