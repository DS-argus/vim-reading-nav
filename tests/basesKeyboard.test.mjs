import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

// Hint handlers, Bases keys, scrolling and search wired in the same order as
// main.ts, with a Bases view active instead of a Markdown Reading view.
const result = await build({
	stdin: { contents: `
		export { BasesHintHandler, collectBasesHintTargets } from './src/basesHintHandler';
		export { BasesKeyHandler } from './src/basesKeyHandler';
		export { LinkHintHandler } from './src/linkHintHandler';
		export { HintModes } from './src/hintModes';
		export { ReadingModeScrollHandler } from './src/scrollHandler';
		export { ReadingModeSearchHandler } from './src/searchHandler';
		export { View } from 'obsidian';
	`, resolveDir: process.cwd() },
	bundle: true, write: false, format: 'esm', platform: 'node',
	plugins: [{ name: 'host-mocks', setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
		build.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: `
			export class View { getViewType() { return this.type; } }
			export class MarkdownView extends View { getMode() { return 'preview'; } }
			export class WorkspaceTabs {}
			export class Component {}
			export class TFile {}
			export function parseLinktext(text) { return { path: text, subpath: '' }; }
			export function resolveSubpath() { return null; }
		` }));
		build.onResolve({ filter: /^\.\/(persistentLinkPreview|footnoteResolver|settings)$/ }, (args) => ({ path: args.path, namespace: 'mock' }));
		build.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: {
			'./persistentLinkPreview': `export class PersistentLinkPreview {
				setGuidance() {} reposition() {} close() {} open() {} isOpen() { return false; }
			}`,
			'./footnoteResolver': 'export class FootnoteResolver { register() {} get() { return null; } }',
			'./settings': `export function bindingMatchesEvent(binding, evt) {
				return binding !== null && binding.key === evt.key && binding.ctrl === !!evt.ctrlKey;
			}`,
		}[path] }));
	} }],
});
const {
	BasesHintHandler, BasesKeyHandler, collectBasesHintTargets, LinkHintHandler, HintModes,
	ReadingModeScrollHandler, ReadingModeSearchHandler, View,
} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

function rect(left, top, width, height) {
	return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON() {} };
}

function setRect(element, value) {
	Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: () => value });
	return element;
}

function setSize(element, name, value) {
	Object.defineProperty(element, name, { configurable: true, value });
}

// A table view: a pinned header, then rows laid out top to bottom in reverse DOM order,
// as Bases reuses absolutely positioned rows while scrolling.
const TABLE = `
	<div class="bases-thead" id="thead"></div>
	<div class="bases-table-container" id="table" tabindex="0">
		<div class="bases-tr" id="row-low">
			<div class="bases-td"><span class="internal-link" id="low" data-href="Low">Low</span></div>
			<div class="bases-td"><div class="metadata-link-inner external-link" id="url" data-href="https://example.com">url</div></div>
		</div>
		<div class="bases-tr" id="row-high">
			<div class="bases-td"><span class="internal-link" id="high" data-href="High">High</span></div>
		</div>
		<div class="bases-tr"><div class="bases-td"><span class="internal-link" id="under-header" data-href="Hidden">Hidden</span></div></div>
		<div class="bases-tr"><div class="bases-td"><span class="internal-link" id="below" data-href="Below">Below</span></div></div>
	</div>`;

const CARDS = `
	<div class="bases-cards-container">
		<div class="bases-cards-group" id="tester" style="opacity: 0; pointer-events: none">
			<div class="bases-group-heading mod-collapsible" id="tester-heading"></div>
			<div class="bases-cards-item" id="tester-card"></div>
		</div>
		<div class="bases-cards-group">
			<div class="bases-group-heading mod-collapsible" id="group-b"></div>
			<div class="bases-cards-item" id="card"><div class="bases-cards-line"><a class="external-link" id="card-url" href="https://example.com/a">a</a></div></div>
		</div>
		<div class="bases-cards-group"><div class="bases-group-heading mod-collapsible" id="group-a"></div></div>
	</div>`;

// Four columns of 280px, 8px apart, after 12px of padding, as Bases measures them.
const BOARD = `
	<div class="bases-kanban-container">
		${['A', 'B', 'C', 'D'].map((key) => `
			<div class="bases-kanban-column" id="col-${key}" data-key="${key}">
				<div class="bases-kanban-column-header"><div class="bases-group-heading" id="heading-${key}"></div></div>
				<div class="bases-kanban-column-content" id="content-${key}"></div>
			</div>`).join('')}
	</div>`;

const RECTS = {
	thead: rect(0, 100, 800, 30), table: rect(0, 130, 800, 2000),
	'row-low': rect(0, 200, 800, 30), low: rect(10, 205, 60, 20), url: rect(300, 205, 120, 20),
	'row-high': rect(0, 160, 800, 30), high: rect(10, 165, 60, 20),
	'under-header': rect(10, 110, 60, 20), below: rect(10, 640, 60, 20),
	tester: rect(0, 0, 200, 100), 'tester-card': rect(10, 140, 200, 100), 'tester-heading': rect(10, 110, 200, 20),
	'group-a': rect(10, 120, 600, 20), 'group-b': rect(10, 300, 600, 20),
	card: rect(10, 330, 200, 100), 'card-url': rect(20, 390, 150, 20),
	'heading-A': rect(20, 120, 260, 20), 'heading-B': rect(310, 120, 260, 20),
};

function setup(contents, { type = 'bases', layout = 'table', enabled = true, views = ['First', 'Second', 'Third'] } = {}) {
	const { document } = parseHTML(`<html><body><div id="pane"><div class="bases-view" id="scroll">${contents}</div></div></body></html>`);
	const win = document.defaultView;
	const proto = win.HTMLElement.prototype;
	proto.addClass ??= function (name) { this.classList.add(name); };
	proto.removeClass ??= function (name) { this.classList.remove(name); };
	proto.toggleClass ??= function (name, force) { this.classList.toggle(name, force); };
	proto.instanceOf ??= function (constructor) { return this instanceof constructor; };
	win.getComputedStyle = (el) => ({
		overflowX: 'visible', overflowY: 'visible', lineHeight: '20px', direction: 'ltr',
		pointerEvents: el.closest('[style*="pointer-events: none"]') ? 'none' : 'auto',
	});
	document.body.createSpan = ({ cls, text }) => {
		const span = document.createElement('span');
		span.className = cls;
		span.textContent = text;
		document.body.append(span);
		return span;
	};
	const scroll = setRect(document.querySelector('#scroll'), rect(0, 100, 800, 500));
	setSize(scroll, 'clientHeight', 500);
	setSize(scroll, 'clientWidth', 800);
	setSize(scroll, 'scrollHeight', 3000);
	scroll.scrollTop = 0;
	scroll.scrollLeft = 0;
	for (const [id, value] of Object.entries(RECTS)) {
		const el = document.getElementById(id);
		if (el) setRect(el, value);
	}
	const columns = [...document.querySelectorAll('.bases-kanban-column')].map((el) => {
		const contentEl = el.querySelector('.bases-kanban-column-content');
		setSize(contentEl, 'clientHeight', 400);
		setSize(contentEl, 'scrollHeight', 2000);
		contentEl.scrollTop = 0;
		return { group: { key: el.getAttribute('data-key') }, containerEl: el, contentEl };
	});
	const clicks = [];
	for (const el of document.querySelectorAll('.internal-link, .external-link, .bases-cards-item, .bases-group-heading')) {
		// Like Bases, a card ignores clicks that start on a link inside it.
		el.addEventListener('click', (evt) => {
			if (el.matches('.bases-cards-item') && evt.target.closest('a')) return;
			clicks.push(el.id);
		});
	}

	let focused = 0;
	const layoutView = {
		type: layout, focus() { focused++; },
		columns, measurements: { pad: { top: 12, bottom: 12, start: 12, end: 12 }, columnWidth: 280, columnGap: 8 },
	};
	const controller = {
		viewName: views[0], view: layoutView,
		getQueryViewNames: () => views,
		selectView(name) { this.viewName = name; },
	};
	const view = new View();
	Object.assign(view, { type, controller, containerEl: document.querySelector('#pane') });
	const commands = [];
	const capture = [];
	const bubble = [];
	const plugin = {
		app: {
			workspace: { on() { return {}; }, getActiveViewOfType: (cls) => view instanceof cls ? view : null, iterateAllLeaves() {} },
			commands: { executeCommandById: (id) => { commands.push(id); return true; } },
		},
		settings: {
			halfPageDown: { key: 'd', ctrl: true }, halfPageUp: null, fullPageDown: null, fullPageUp: null,
			enableSplitOpening: true, showPreviewOpeningGuidance: true, openExternalLinksImmediately: false,
			enableBasesNavigation: enabled,
		},
		registerDomEvent(target, type, callback, options) {
			if (type !== 'keydown' || target !== document) return;
			(options === true ? capture : bubble).push(callback);
		},
		registerEvent() {},
		register() {},
	};
	const modes = new HintModes();
	const linkHints = new LinkHintHandler(plugin, modes);
	const basesHints = new BasesHintHandler(plugin, modes);
	// Same order as main.ts registerForDocument.
	linkHints.registerTo(document);
	basesHints.registerTo(document);
	new BasesKeyHandler(plugin).registerTo(document);
	new ReadingModeScrollHandler(plugin, plugin.settings).registerTo(document);
	new ReadingModeSearchHandler(plugin).registerTo(document);

	// A focused Bases table answers keys on its own element, between the capture and bubble phases.
	const tableKeys = [];
	const press = (key, options = {}) => {
		const event = {
			key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...options,
			targetNode: options.target ?? document.querySelector('#table') ?? scroll,
			defaultPrevented: false, stopped: false,
			preventDefault() { this.defaultPrevented = true; },
			stopImmediatePropagation() { this.stopped = true; },
		};
		const previous = globalThis.HTMLElement;
		globalThis.HTMLElement = win.HTMLElement;
		try {
			for (const listener of capture) {
				listener(event);
				if (event.stopped) return event;
			}
			if (!event.defaultPrevented) tableKeys.push(key);
			for (const listener of bubble) {
				listener(event);
				if (event.stopped) break;
			}
		} finally {
			if (previous === undefined) delete globalThis.HTMLElement;
			else globalThis.HTMLElement = previous;
		}
		return event;
	};
	const badges = () => [...document.querySelectorAll('.vim-reading-nav-hint')];
	const labels = () => badges().map((hint) => hint.textContent);
	const content = (key) => document.getElementById(`content-${key}`);
	const outlined = () => [...document.querySelectorAll('.vim-reading-nav-board-column')].map((el) => el.getAttribute('data-key'));
	return { document, scroll, press, clicks, commands, tableKeys, badges, labels, controller, focused: () => focused, content, outlined };
}

test('hint targets are visible links and cards in reading order, below the pinned header', () => {
	const dom = setup(TABLE);
	assert.deepEqual(collectBasesHintTargets(dom.scroll, 'click').map((target) => target.el.id), ['high', 'low', 'url']);
});

test('the invisible card and heading Bases measures layout with get no hint', () => {
	const dom = setup(CARDS, { layout: 'cards' });
	const targets = collectBasesHintTargets(dom.scroll, 'click');
	assert.deepEqual(targets.map((target) => [target.el.id, target.item]), [['card', true], ['card-url', false]]);
	assert.deepEqual(collectBasesHintTargets(dom.scroll, 'fold').map((target) => target.el.id), ['group-a', 'group-b']);
});

test('f then a label clicks the target like a mouse click', () => {
	const dom = setup(TABLE);
	assert.equal(dom.press('f').defaultPrevented, true);
	assert.deepEqual(dom.labels(), ['A', 'S', 'D']);
	dom.press('s');
	assert.deepEqual(dom.clicks, ['low']);
	assert.deepEqual(dom.labels(), [], 'choosing a target closes the hints');
	dom.press('f');
	dom.press('d');
	assert.deepEqual(dom.clicks, ['low', 'url'], 'URL property links are clicked too');
	assert.deepEqual(dom.tableKeys, [], 'the table never sees the hint keys');
});

test('a card label opens the card; a link inside it has its own label', () => {
	const dom = setup(CARDS, { layout: 'cards' });
	dom.press('f');
	dom.press('a');
	dom.press('f');
	dom.press('s');
	assert.deepEqual(dom.clicks, ['card', 'card-url']);
});

test('F then a label folds a group like clicking its heading', () => {
	const dom = setup(CARDS, { layout: 'cards' });
	dom.press('F', { shiftKey: true });
	assert.deepEqual(dom.labels(), ['A', 'S']);
	assert.ok(dom.badges().every((badge) => badge.classList.contains('vim-reading-nav-heading-hint')), 'fold hints share the heading-fold color');
	dom.press('s');
	assert.deepEqual(dom.clicks, ['group-b']);
});

test('board column headings do not fold, so F shows no hints there', () => {
	const dom = setup(BOARD, { layout: 'kanban' });
	assert.equal(dom.press('F', { shiftKey: true }).defaultPrevented, true);
	assert.deepEqual(dom.labels(), []);
});

test('while hints show, Backspace edits the label instead of clearing table cells', () => {
	const dom = setup(TABLE);
	dom.press('f');
	assert.equal(dom.press('Backspace').stopped, true);
	assert.deepEqual(dom.tableKeys, []);
	dom.press('Escape');
	assert.deepEqual(dom.labels(), []);
	assert.deepEqual(dom.clicks, []);
});

test('hjkl, d/u and gg/G scroll the Bases results without moving the active cell', () => {
	const dom = setup(TABLE);
	dom.press('j');
	dom.press('j');
	assert.equal(dom.scroll.scrollTop, 60);
	dom.press('k');
	assert.equal(dom.scroll.scrollTop, 30);
	dom.press('l');
	dom.press('l');
	dom.press('h');
	assert.equal(dom.scroll.scrollLeft, 30);
	dom.press('d');
	assert.equal(dom.scroll.scrollTop, 280);
	dom.press('u');
	assert.equal(dom.scroll.scrollTop, 30);
	dom.press('G');
	assert.equal(dom.scroll.scrollTop, 3000);
	dom.press('g');
	dom.press('g');
	assert.equal(dom.scroll.scrollTop, 0);
	dom.press('d', { ctrlKey: true });
	assert.equal(dom.scroll.scrollTop, 250, 'configured page bindings scroll Bases too');
	assert.deepEqual(dom.tableKeys, []);
});

test('on a board, h/l choose a column, showing it, and the other keys scroll that column', () => {
	const dom = setup(BOARD, { layout: 'kanban' });
	dom.press('j');
	assert.equal(dom.content('A').scrollTop, 30, 'the first column starts chosen');
	assert.deepEqual(dom.outlined(), ['A']);
	dom.press('l');
	dom.press('j');
	assert.equal(dom.content('B').scrollTop, 30);
	assert.equal(dom.scroll.scrollLeft, 0, 'a column already in view does not scroll the board');
	assert.deepEqual(dom.outlined(), ['B']);
	dom.press('l');
	assert.equal(dom.scroll.scrollLeft, 76, 'the board scrolls just enough to show the column and the gap after it');
	dom.press('l');
	assert.equal(dom.scroll.scrollLeft, 368, 'the last column shows the board padding after it');
	dom.press('l');
	assert.deepEqual(dom.outlined(), ['D'], 'l stops at the last column');
	dom.press('d', { ctrlKey: true });
	dom.press('G');
	assert.equal(dom.content('D').scrollTop, 2000);
	dom.press('h');
	assert.deepEqual(dom.outlined(), ['C']);
	assert.equal(dom.scroll.scrollLeft, 368, 'a column in view does not scroll the board back');
	assert.equal(dom.scroll.scrollTop, 0, 'the board itself never scrolls vertically');
});

test('when the chosen column scrolls out of view, the first column in view takes over', () => {
	const dom = setup(BOARD, { layout: 'kanban' });
	for (let i = 0; i < 3; i++) dom.press('l');
	dom.scroll.scrollLeft = 0;
	dom.press('j');
	assert.equal(dom.content('A').scrollTop, 30);
	assert.equal(dom.content('D').scrollTop, 0);
	assert.deepEqual(dom.outlined(), ['A']);
});

test('Shift+J/K switch to the next or previous view, wrapping around', () => {
	const dom = setup(TABLE);
	const shown = [];
	for (const key of ['J', 'J', 'J', 'K']) {
		assert.equal(dom.press(key, { shiftKey: true }).defaultPrevented, true);
		shown.push(dom.controller.viewName);
	}
	assert.deepEqual(shown, ['Second', 'Third', 'First', 'Third']);
	assert.equal(dom.focused(), 4, 'the new view takes focus, like Obsidian\'s own shortcut');
	dom.press('J', { shiftKey: true, repeat: true });
	assert.equal(dom.controller.viewName, 'Third', 'holding the key switches only once');
	assert.deepEqual(dom.tableKeys, []);
});

test('table keys that are not mapped still reach the table', () => {
	const dom = setup(TABLE);
	for (const key of ['ArrowDown', 'Enter', 'Escape', 'Backspace', 'Tab']) dom.press(key);
	assert.deepEqual(dom.tableKeys, ['ArrowDown', 'Enter', 'Escape', 'Backspace', 'Tab']);
	assert.equal(dom.scroll.scrollTop, 0);
});

test('typing in a cell editor or the Bases search box is left alone', () => {
	const dom = setup(`${TABLE}<input id="search"><div id="editor" contenteditable="true"></div>`);
	for (const id of ['search', 'editor']) {
		const target = dom.document.getElementById(id);
		if (id === 'editor') Object.defineProperty(target, 'isContentEditable', { value: true });
		for (const key of ['j', 'f', 'F', 'J', '/']) assert.equal(dom.press(key, { target }).defaultPrevented, false, `${key} in ${id}`);
	}
	assert.equal(dom.scroll.scrollTop, 0);
	assert.equal(dom.controller.viewName, 'First');
	assert.deepEqual(dom.labels(), []);
	assert.deepEqual(dom.commands, []);
});

test('/ opens the Bases search', () => {
	const dom = setup(TABLE);
	assert.equal(dom.press('/').defaultPrevented, true);
	assert.deepEqual(dom.commands, ['editor:open-search']);
});

test('with the experimental setting off, Bases keys are left alone', () => {
	const dom = setup(TABLE, { enabled: false });
	for (const key of ['j', 'l', 'f', 'F', 'J', '/']) assert.equal(dom.press(key).defaultPrevented, false, key);
	assert.equal(dom.press('d', { ctrlKey: true }).defaultPrevented, false, 'page bindings too');
	assert.equal(dom.scroll.scrollTop, 0);
	assert.equal(dom.controller.viewName, 'First');
	assert.deepEqual(dom.labels(), []);
	assert.deepEqual(dom.commands, []);
});

test('a layout added by another plugin keeps its keys; only view switching and search apply', () => {
	const dom = setup(TABLE, { layout: 'map' });
	for (const key of ['j', 'l', 'f', 'F']) assert.equal(dom.press(key).defaultPrevented, false, key);
	assert.equal(dom.press('d', { ctrlKey: true }).defaultPrevented, false);
	assert.deepEqual(dom.labels(), []);
	dom.press('J', { shiftKey: true });
	assert.equal(dom.controller.viewName, 'Second');
	dom.press('/');
	assert.deepEqual(dom.commands, ['editor:open-search']);
});

test('other views are not treated as Bases', () => {
	const dom = setup(TABLE, { type: 'canvas' });
	for (const key of ['j', 'l', 'f', 'J', '/']) assert.equal(dom.press(key).defaultPrevented, false, key);
	assert.equal(dom.scroll.scrollTop, 0);
	assert.equal(dom.controller.viewName, 'First');
	assert.deepEqual(dom.commands, []);
});
