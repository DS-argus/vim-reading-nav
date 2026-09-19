import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

const result = await build({
	stdin: { contents: `
		export { LinkHintHandler } from './src/linkHintHandler';
		export {
			collectMarkdownEmbedTargets,
			collectVisibleLinkHintTargets,
			createHintElement,
		} from './src/markdownEmbedHints';
		export { MarkdownView, TFile } from 'obsidian';
	`, resolveDir: process.cwd() },
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'node',
	plugins: [{ name: 'host-mocks', setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
		build.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: `
			export class App {}
			export class Component {}
			export class MarkdownView { getMode() { return this.mode ?? 'preview'; } }
			export class WorkspaceTabs {}
			export class TFile {
				constructor(path) { this.path = path; this.extension = path.includes('.') ? path.split('.').pop() : ''; }
			}
			export function parseLinktext(text) {
				const hash = text.indexOf('#');
				return { path: hash < 0 ? text : text.slice(0, hash), subpath: hash < 0 ? '' : text.slice(hash) };
			}
			export function resolveSubpath(cache, subpath) { return cache?.[subpath] ?? null; }
		` }));
		build.onResolve({ filter: /^\.\/(persistentLinkPreview|footnoteResolver|settings)$/ }, args => ({ path: args.path, namespace: 'mock' }));
		build.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: {
			'./persistentLinkPreview': `
				export class PersistentLinkPreview {
					constructor() { this.opened = false; }
					setGuidance() {}
					reposition() {}
					close() { this.opened = false; }
					open() { this.opened = true; }
					openExternal() { this.opened = true; }
					openFootnote() { this.opened = true; }
					openFootnoteStatus() { this.opened = true; }
					isOpen() { return this.opened; }
					showOpenError(message) { this.error = message; }
					scroll() {}
				}
			`,
			'./footnoteResolver': `
				export class FootnoteResolver {
					constructor() {}
					register() {}
					get() { return null; }
					definitionMarkdown() { return Promise.resolve(null); }
				}
			`,
			'./settings': 'export function bindingMatchesEvent() { return false; }',
		}[path] }));
	} }],
});

const { LinkHintHandler, collectMarkdownEmbedTargets, collectVisibleLinkHintTargets, createHintElement, MarkdownView, TFile } = await import(
	`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`,
);

function rect(left, top, width, height) {
	return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON() {} };
}

function setRect(element, value) {
	Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: () => value });
	return element;
}

function patchDocument(document) {
	const Element = document.defaultView.HTMLElement;
	if (!Element.prototype.addClass) Element.prototype.addClass = function (name) { this.classList.add(name); };
	if (!Element.prototype.removeClass) Element.prototype.removeClass = function (name) { this.classList.remove(name); };
	if (!Element.prototype.toggleClass) Element.prototype.toggleClass = function (name, force) { this.classList.toggle(name, force); };
	if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {};
	document.body.createSpan = ({ cls, text }) => {
		const span = document.createElement('span');
		span.className = cls;
		span.textContent = text;
		document.body.append(span);
		return span;
	};
	return document;
}

function fixture(contents) {
	const { document } = parseHTML(`<html><body><div id="pane"><div class="markdown-reading-view"><div id="scroll" class="markdown-preview-view">${contents}</div></div></div></body></html>`);
	patchDocument(document);
	const pane = document.querySelector('#pane');
	const scroll = document.querySelector('#scroll');
	setRect(scroll, rect(0, 0, 500, 600));
	document.body.instanceOf = constructor => document.body instanceof constructor;
	return { document, pane, scroll };
}

function metadataApp({ sourcePath = 'source.md', targets = {} } = {}) {
	const source = new TFile(sourcePath);
	const files = new Map(Object.entries(targets).map(([path, extension]) => [path, new TFile(path.includes('.') ? path : `${path}.${extension ?? 'md'}`)]));
	files.set(sourcePath, source);
	const cache = file => file?.path === sourcePath || file?.extension === 'md'
		? { '#heading': {}, '#^block': {} }
		: null;
	return {
		vault: { getAbstractFileByPath: path => files.get(path) ?? null },
		metadataCache: {
			getFirstLinkpathDest: path => files.get(path) ?? files.get(`${path}.md`) ?? null,
			getFileCache: file => cache(file),
		},
		workspace: {},
	};
}


function sourceView(pane, sourcePath = 'source.md') {
	const source = new TFile(sourcePath);
	return Object.assign(new MarkdownView(), {
		containerEl: pane,
		file: source,
		previewMode: { rerender() {} },
	});
}

function handlerFixture(contents, app, sourcePath = 'source.md') {
	const dom = fixture(contents);
	let activeView = sourceView(dom.pane, sourcePath);
	const leaves = [];
	const callbacks = [];
	const workspace = {
		on() { return { off() {} }; },
		iterateAllLeaves(callback) { leaves.forEach(callback); },
		getActiveViewOfType() { return activeView; },
		openLinkText() {},
	};
	app.workspace = workspace;
	const plugin = {
		app,
		settings: {
			enableSplitOpening: true,
			showPreviewOpeningGuidance: true,
			openExternalLinksImmediately: false,
		},
		registerDomEvent(_target, type, callback) { callbacks.push({ type, callback }); },
		registerEvent() {},
		register() {},
	};
	const handler = new LinkHintHandler(plugin);
	handler.registerTo(dom.document);
	const state = handler.stateFor(dom.document);
	const press = key => {
		const event = {
			key,
			shiftKey: key === key.toUpperCase(),
			targetNode: dom.document.body,
			preventDefault() {},
			stopImmediatePropagation() {},
		};
		const previous = globalThis.HTMLElement;
		globalThis.HTMLElement = dom.document.defaultView.HTMLElement;
		try {
			callbacks.find(entry => entry.type === 'keydown').callback(event);
		} finally {
			if (previous === undefined) delete globalThis.HTMLElement;
			else globalThis.HTMLElement = previous;
		}
	};
	return {
		...dom,
		app,
		plugin,
		handler,
		state,
		press,
		workspace,
		setActiveView(view) { activeView = view; },
	};
}

const noFootnotes = { get: () => null };

test('collects only resolved, top-level Markdown embeds and preserves the real DIV control', () => {
	const dom = fixture(`
		<div id="good" class="markdown-embed" src="target"><div class="markdown-embed-link">open</div></div>
		<div id="heading" class="markdown-embed" src="#heading"><div class="markdown-embed-link">heading</div></div>
		<div id="block" class="markdown-embed" src="#^block"><div class="markdown-embed-link">block</div></div>
		<div id="extensionless" class="markdown-embed" src="extensionless"><div class="markdown-embed-link">md</div></div>
		<div id="nested-parent" class="markdown-embed" src="target"><div class="markdown-embed-link">outer</div>
			<div id="nested" class="markdown-embed" src="target"><div class="markdown-embed-link">nested</div></div>
		</div>
		<div id="missing" class="markdown-embed" src="missing"><div class="markdown-embed-link">missing</div></div>
		<div id="missing-source" class="markdown-embed" src="#heading"><div class="markdown-embed-link">source</div></div>
		<div id="pdf" class="markdown-embed pdf-embed" src="asset.pdf"><div class="markdown-embed-link">pdf</div></div>
		<div id="image" class="markdown-embed image-embed" src="asset.png"><div class="markdown-embed-link">image</div></div>
		<div id="audio" class="markdown-embed audio-embed" src="asset.mp3"><div class="markdown-embed-link">audio</div></div>
		<div id="video" class="markdown-embed video-embed" src="asset.mp4"><div class="markdown-embed-link">video</div></div>
		<div id="canvas" class="markdown-embed canvas-embed" src="board.canvas"><div class="markdown-embed-link">canvas</div></div>
	`);
	const roots = [...dom.scroll.querySelectorAll('.markdown-embed')];
	roots.forEach((root, index) => {
		setRect(root, rect(0, index * 20, 400, 18));
		setRect(root.querySelector('.markdown-embed-link'), rect(8, index * 20, 40, 18));
	});
	const app = metadataApp({ targets: {
		target: 'md', extensionless: 'md',
		'asset.pdf': 'pdf', 'asset.png': 'png', 'asset.mp3': 'mp3', 'asset.mp4': 'mp4', 'board.canvas': 'canvas',
	} });

	const targets = collectMarkdownEmbedTargets(dom.scroll, app, 'source.md');
	assert.deepEqual(targets.map(target => target.root.id), ['good', 'heading', 'block', 'extensionless', 'nested-parent', 'missing-source']);
	assert.deepEqual(targets.map(target => target.linktext), ['target', '#heading', '#^block', 'extensionless', 'target', '#heading']);
	assert.ok(targets.every(target => target.sourcePath === 'source.md'));
	assert.ok(targets.every(target => target.element.tagName === 'DIV'));
	assert.ok(targets.every(target => target.element === target.root.querySelector('.markdown-embed-link')));
	assert.equal(targets.find(target => target.root.id === 'nested-parent').element.matches('a'), false);
	const missingSource = collectMarkdownEmbedTargets(dom.scroll, app, 'not-in-vault.md');
	assert.ok(!missingSource.some(target => target.root.id === 'missing-source'));
});

test('excludes hidden/offscreen embeds and clamps a partially visible long embed hint', () => {
	const dom = fixture(`
		<div id="hidden" class="markdown-embed" src="target"><div class="markdown-embed-link">hidden</div></div>
		<div id="offscreen" class="markdown-embed" src="target"><div class="markdown-embed-link">offscreen</div></div>
		<div id="long" class="markdown-embed" src="target"><div id="long-control" class="markdown-embed-link">long</div></div>
	`);
	setRect(dom.scroll.querySelector('#hidden'), rect(0, 100, 0, 0));
	setRect(dom.scroll.querySelector('#offscreen'), rect(0, 700, 400, 100));
	setRect(dom.scroll.querySelector('#long'), rect(30, -100, 450, 1000));
	setRect(dom.scroll.querySelector('#long-control'), rect(40, 700, 40, 20));
	const app = metadataApp({ targets: { target: 'md' } });
	const targets = collectMarkdownEmbedTargets(dom.scroll, app, 'source.md');
	assert.deepEqual(targets.map(target => target.root.id), ['long']);
	const hint = createHintElement('a', targets[0], dom.document, dom.scroll.getBoundingClientRect());
	assert.ok(Number.parseFloat(hint.style.top) >= 0 && Number.parseFloat(hint.style.top) <= 600);
	assert.ok(Number.parseFloat(hint.style.left) >= 0 && Number.parseFloat(hint.style.left) <= 500);
});
test('keeps ordinary links in document order while suppressing nested embed links', () => {
	const dom = fixture(`
		<a id="before" class="internal-link" data-href="before">before</a>
		<div id="outer" class="markdown-embed" src="target"><div class="markdown-embed-link">outer</div>
			<a id="inside" class="internal-link" data-href="inside">inside</a>
			<div id="nested" class="markdown-embed" src="target"><div class="markdown-embed-link">nested</div>
				<a id="nested-inside" class="internal-link" data-href="nested-inside">nested inside</a>
			</div>
		</div>
		<a id="external" href="https://example.test/">external</a>
		<a id="after" class="internal-link" data-href="after">after</a>
	`);
	const ids = ['before', 'inside', 'nested', 'nested-inside', 'external', 'after'];
	ids.forEach((id, index) => setRect(dom.scroll.querySelector(`#${id}`), rect(index * 20, 10, 12, 18)));
	setRect(dom.scroll.querySelector('#outer'), rect(0, 0, 450, 100));
	const app = metadataApp({ targets: { before: 'md', inside: 'md', target: 'md', after: 'md' } });
	const targets = collectVisibleLinkHintTargets(dom.scroll, app, 'source.md', noFootnotes);
	assert.deepEqual(targets.map(target => target.kind === 'internal' ? (target.root ?? target.element).id : target.link.id), ['before', 'outer', 'external', 'after']);
});

test('keeps hint state isolated per document and cancels disconnected targets', () => {
	const app = metadataApp({ targets: { target: 'md' } });
	const first = handlerFixture('<div id="embed-one" class="markdown-embed" src="target"><div class="markdown-embed-link">one</div></div>', app);
	const second = fixture('<div id="embed-two" class="markdown-embed" src="target"><div class="markdown-embed-link">two</div></div>');
	for (const dom of [first, second]) {
		const root = dom.scroll.querySelector('.markdown-embed');
		const control = root.querySelector('.markdown-embed-link');
		setRect(root, rect(0, 20, 300, 80));
		setRect(control, rect(10, 20, 40, 18));
	}
	const secondView = sourceView(second.pane);
	first.handler.registerTo(second.document);
	first.press('f');
	first.setActiveView(secondView);
	const pressSecond = key => {
		const event = {
			key,
			shiftKey: key === key.toUpperCase(),
			targetNode: second.document.body,
			preventDefault() {},
			stopImmediatePropagation() {},
		};
		const previous = globalThis.HTMLElement;
		globalThis.HTMLElement = second.document.defaultView.HTMLElement;
		try {
			first.handler.handleKeyDown(event, second.document);
		} finally {
			if (previous === undefined) delete globalThis.HTMLElement;
			else globalThis.HTMLElement = previous;
		}
	};
	pressSecond('f');
	const secondState = first.handler.stateFor(second.document);
	assert.equal(first.state.active, true);
	assert.equal(secondState.active, true);
	assert.ok(first.state.hints.every(hint => hint.target.element.ownerDocument === first.document));
	assert.ok(secondState.hints.every(hint => hint.target.element.ownerDocument === second.document));
	secondState.session.focusHint(first.state.hints[0].target);
	assert.equal(secondState.session.focusedTarget, null);
	first.state.session.focusHint(first.state.hints[0].target);
	const focused = first.state.hints[0].target.element;
	focused.remove();
	first.state.session.reapInvalid();
	assert.equal(first.state.session.focusedTarget, null);
});

test('metadata excludes non-Markdown files even without media CSS classes', () => {
	for (const extension of ['pdf', 'png', 'mp3', 'mp4', 'canvas']) {
		const dom = fixture('<div class="markdown-embed" src="alias"><div class="markdown-embed-link"></div></div>');
		setRect(dom.scroll.querySelector('.markdown-embed'), rect(10, 10, 300, 100));
		assert.equal(collectMarkdownEmbedTargets(dom.scroll, metadataApp({ targets: { alias: extension } }), 'source.md').length, 0);
	}
});

test('footnote selectors without href remain supported and unresolved references are excluded', () => {
	const dom = fixture('<a class="footnote-link" id="valid">1</a><sup class="footnote-ref"><a id="inline">2</a></sup><a class="footnote-link internal-link" data-href="target" id="missing">3</a>');
	for (const link of dom.scroll.querySelectorAll('a')) setRect(link, rect(10, 20, 20, 20));
	const footnotes = { get: link => link.id === 'valid' ? { kind: 'standard', id: 'fn1' } : link.id === 'inline' ? { kind: 'inline', markdown: 'definition' } : undefined };
	const targets = collectVisibleLinkHintTargets(dom.scroll, metadataApp(), 'source.md', footnotes);
	assert.deepEqual(targets.map(target => [target.kind, target.link.id]), [['standardFootnote', 'valid'], ['inlineFootnote', 'inline']]);
});

test('zero-layout embed controls place hints inside the visible pane', () => {
	const dom = fixture('<div class="markdown-embed" src="target"><div class="markdown-embed-link"></div></div>');
	setRect(dom.scroll, rect(500, 100, 500, 600));
	setRect(dom.scroll.querySelector('.markdown-embed'), rect(520, -100, 450, 1000));
	setRect(dom.scroll.querySelector('.markdown-embed-link'), rect(0, 0, 0, 0));
	const [target] = collectMarkdownEmbedTargets(dom.scroll, metadataApp({ targets: { target: 'md' } }), 'source.md');
	const hint = createHintElement('a', target, dom.document, dom.scroll.getBoundingClientRect());
	assert.equal(Number.parseFloat(hint.style.left), 520);
	assert.ok(Number.parseFloat(hint.style.top) >= 100 && Number.parseFloat(hint.style.top) < 700);
});

for (const height of [100, 1200]) {
	test(`embed hint follows the right-hand icon rather than its full-width control, height=${height}`, () => {
		const dom = fixture('<div class="markdown-embed" src="target"><div class="markdown-embed-link"><svg></svg></div></div>');
		const root = dom.scroll.querySelector('.markdown-embed');
		const control = root.querySelector('.markdown-embed-link');
		setRect(root, rect(30, 400, 450, height));
		setRect(control, rect(30, 400, 450, 24));
		setRect(control.querySelector('svg'), rect(460, 404, 16, 16));
		const [target] = collectMarkdownEmbedTargets(dom.scroll, metadataApp({ targets: { target: 'md' } }), 'source.md');
		const hint = createHintElement('a', target, dom.document, dom.scroll.getBoundingClientRect());
		assert.equal(Number.parseFloat(hint.style.left), 460);
		assert.equal(Number.parseFloat(hint.style.top), 412);
		assert.ok(target.element === control);
	});
}
