import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const result = await build({
	stdin: { contents: `export * from './src/cursorManager'; export * from './src/cursorPlacement'; export * from './src/settings'; export { MarkdownView, Setting } from 'obsidian';`, resolveDir: process.cwd() },
	bundle: true, write: false, format: 'esm', platform: 'node',
	plugins: [{ name: 'obsidian-host', setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
		build.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: `
			export class MarkdownView { getMode() { return this.mode; } }
			export class Component { register() {} registerEvent() {} registerDomEvent() {} unload() {} }
			export class Notice {}
			export const Platform = { isMacOS: false, isWin: false, isLinux: false };
			export function setIcon() {}
			export class PluginSettingTab { constructor() { this.containerEl = null; } hide() {} }
			export class Setting {
				static rows = [];
				constructor() { Setting.rows.push(this); this.controlEl = { createSpan() { return {}; } }; }
				setName(value) { this.name = value; return this; }
				setDesc(value) { this.desc = value; return this; }
				setHeading() { this.heading = true; return this; }
				setDisabled() { return this; }
				control(fn) {
					const control = {
						setValue(value) { this.value = value; return this; },
						setLimits(...limits) { this.limits = limits; return this; },
						setDynamicTooltip() { return this; },
						addOptions(value) { this.options = value; return this; },
						onChange(fn) { this.change = fn; return this; },
						setButtonText() { return this; }, setDisabled() { return this; }, onClick() { return this; }
					};
					fn(control); return control;
				}
				addSlider(fn) { this.slider = this.control(fn); return this; }
				addDropdown(fn) { this.dropdown = this.control(fn); return this; }
				addToggle(fn) { this.toggle = this.control(fn); return this; }
				addButton(fn) { this.button = this.control(fn); return this; }
			}
		` }));
	} }],
});
const {
	CursorManager, MarkdownView, Setting, VimReadingNavSettingTab, PLACEMENT_FRAME_LIMIT,
	placementTarget, DEFAULT_SETTINGS,
} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

const point = (line, ch = 0) => ({ line, ch });

function windowFixture() {
	const frames = new Map();
	let serial = 0;
	const win = {
		closed: false,
		requestAnimationFrame(callback) { const id = ++serial; frames.set(id, callback); return id; },
		cancelAnimationFrame(id) { frames.delete(id); },
	};
	const doc = { defaultView: win };
	return {
		win, doc, frames,
		flush(count = 1) {
			for (let i = 0; i < count; i++) {
				const pending = [...frames.values()];
				frames.clear();
				pending.forEach(callback => callback());
			}
		},
	};
}

function editorFixture(owner, options = {}) {
	const lines = options.lines ?? Array.from({ length: 120 }, () => 'x'.repeat(30));
	const starts = [], rows = [];
	let offset = 0, y = 0;
	for (let line = 0; line < lines.length; line++) {
		starts.push(offset);
		const widgetHeight = options.widgetLines?.[line];
		const height = widgetHeight ?? options.rowHeights?.[line] ?? 20;
		rows.push({ line, from: offset, top: y, bottom: y + height, widget: widgetHeight !== undefined });
		y += height;
		offset += lines[line].length + 1;
	}
	const state = {
		px: 0, ready: options.ready ?? true,
		readingScroll: options.readingScroll ?? 0,
		sourceScroll: options.sourceScroll ?? 0,
		head: options.head ?? point(lines.length - 1),
		anchor: options.anchor ?? point(lines.length - 1),
	};
	const calls = [];
	const pixelsForScroll = scroll => {
		const bounded = Math.min(lines.length - 1, Math.max(0, scroll));
		const line = Math.floor(bounded), row = rows[line];
		return row.top + (bounded - line) * (row.bottom - row.top);
	};
	state.px = pixelsForScroll(options.mode === 'source' ? state.sourceScroll : state.readingScroll);
	const posToOffset = pos => starts[pos.line] + pos.ch;
	const offsetToPos = pos => {
		const line = starts.findLastIndex(start => start <= pos);
		return point(line, Math.min(lines[line].length, pos - starts[line]));
	};
	const ordinaryRowAt = worldY => {
		let row = rows.find(candidate => candidate.top <= worldY && worldY < candidate.bottom)
			?? (worldY < rows[0].top ? rows[0] : rows.at(-1));
		if (!row.widget) return row;
		const before = rows.slice(0, row.line).findLast(candidate => !candidate.widget);
		const after = rows.slice(row.line + 1).find(candidate => !candidate.widget);
		if (!before) return after ?? row;
		if (!after) return before;
		return worldY - row.top < row.bottom - worldY ? before : after;
	};
	const scrollDOM = {
		nodeType: 1, isConnected: true, ownerDocument: owner.doc, clientHeight: options.height ?? 200,
		getBoundingClientRect() { return { left: 10, right: 410, top: 100, bottom: 100 + scrollDOM.clientHeight }; },
	};
	const cm = {
		scrollDOM,
		coordsAtPos(pos) {
			if (!state.ready) return null;
			const { line } = offsetToPos(pos), row = rows[line];
			const glyph = options.shortGlyphs?.[line];
			const top = 100 + row.top - state.px + (glyph?.topOffset ?? 0);
			const bottom = glyph ? top + glyph.height : 100 + row.bottom - state.px;
			return { left: 11, right: 12, top, bottom };
		},
		posAtCoords({ y: screenY }) {
			if (!state.ready) return null;
			return starts[ordinaryRowAt(screenY - 100 + state.px).line];
		},
	};
	const editor = {
		cm,
		lastLine: () => lines.length - 1,
		getLine: line => lines[line],
		posToOffset,
		offsetToPos,
		getCursor(side) { return { ...(side === 'anchor' ? state.anchor : state.head) }; },
		listSelections() { return [{ anchor: { ...state.anchor }, head: { ...state.head } }]; },
		setCursor(pos) { calls.push(['setCursor', { ...pos }]); state.head = { ...pos }; state.anchor = { ...pos }; },
		scrollTo(left, top) { calls.push(['scrollTo', left, top]); state.px = top; },
	};
	return { editor, cm, state, calls, rows, starts, pixelsForScroll };
}

function harness(overrides = {}) {
	const windows = windowFixture(), leaves = [], listeners = new Map(), cleanups = [], domListeners = [], layouts = [];
	const workspace = {
		on(name, callback) {
			const callbacks = listeners.get(name) ?? new Set(); callbacks.add(callback); listeners.set(name, callbacks);
			return { off: () => callbacks.delete(callback) };
		},
		emit(name, ...args) { listeners.get(name)?.forEach(callback => callback(...args)); },
		iterateAllLeaves(callback) { leaves.forEach(callback); },
		onLayoutReady(callback) { layouts.push(callback); },
	};
	const plugin = {
		app: { workspace },
		settings: { ...DEFAULT_SETTINGS, ...overrides },
		register(cleanup) { cleanups.push(cleanup); },
		registerEvent(ref) { cleanups.push(() => ref.off()); },
		registerDomEvent(doc, type, callback, options) {
			const listener = { doc, type, callback, options };
			domListeners.push(listener); cleanups.push(() => domListeners.splice(domListeners.indexOf(listener), 1));
		},
	};
	const manager = new CursorManager(plugin);
	manager.register();
	manager.registerTo(windows.doc);

	function addPane(owner = windows, options = {}) {
		const geometry = editorFixture(owner, options);
		const root = { nodeType: 1 };
		const container = {
			ownerDocument: owner.doc, isConnected: true,
			contains: target => target === root || target === geometry.cm.scrollDOM,
		};
		const view = Object.assign(new MarkdownView(), {
			mode: options.mode ?? 'preview', file: { path: options.path ?? 'note.md' },
			containerEl: container,
			editor: geometry.editor,
			getMode() { return this.mode; },
			setEphemeralState(state) {
				const scroll = state.scroll;
				geometry.calls.push(['setEphemeralState', scroll]);
				if (this.mode === 'preview') geometry.state.readingScroll = scroll;
				else geometry.state.sourceScroll = scroll;
				geometry.state.px = geometry.pixelsForScroll(scroll);
			},
		});
		const leaf = { view }; view.leaf = leaf; leaves.push(leaf);
		return { ...geometry, view, root, leaf, owner };
	}
	function ready() { layouts.splice(0).forEach(callback => callback()); }
	function setScroll(view, mode, value) {
		if (mode === 'preview') view.state.readingScroll = value;
		else view.state.sourceScroll = value;
		view.state.px = view.pixelsForScroll(value);
	}
	function interact(view, type = 'wheel') {
		const target = view.view.mode === 'preview' ? view.root : view.cm.scrollDOM;
		for (const listener of domListeners) {
			if (listener.doc === view.owner.doc && listener.type === type) listener.callback({ target });
		}
	}
	function switchMode(view, mode, event = 'layout-change') {
		view.view.mode = mode;
		workspace.emit(event);
	}
	function unload() { cleanups.splice(0).reverse().forEach(cleanup => cleanup()); }
	return {
		windows, workspace, manager, settings: plugin.settings, domListeners, addPane, ready, setScroll, switchMode, interact, unload,
		run(count = PLACEMENT_FRAME_LIMIT, owner = windows) { owner.flush(count); },
	};
}

function geometry(options = {}) {
	const owner = windowFixture();
	const fixture = editorFixture(owner, options);
	return { ...fixture, target: () => placementTarget(fixture.cm), owner };
}
const scrollSetterCalls = view => view.calls.filter(([name]) =>
	name === 'setEphemeralState' || name === 'scrollTo');
const cursorMoves = view => view.calls.filter(([name]) => name === 'setCursor');


test('settings omit editing controls and put support links above the preserved scope callout', () => {
	const makeElement = (tag, options = {}) => ({
		tag, cls: options.cls, attr: options.attr, text: options.text, href: options.href, children: [],
		empty() { this.children = []; },
		createDiv(options = {}) { return this.createEl('div', options); },
		createEl(tag, options = {}) {
			const child = makeElement(tag, options);
			this.children.push(child);
			return child;
		},
	});
	const element = makeElement('div');
	const plugin = { app: {}, settings: { ...DEFAULT_SETTINGS }, async saveSettings() {} };
	Setting.rows.length = 0;
	assert.equal('editCursorPlacement' in DEFAULT_SETTINGS, false);
	const tab = new VimReadingNavSettingTab(plugin); tab.containerEl = element; tab.display();
	assert.equal(Setting.rows.some(setting => setting.name === 'Editing'), false);
	assert.equal(Setting.rows.some(setting => setting.name === 'Cursor placement'), false);
	assert.equal(Setting.rows.some(setting => setting.name === 'Support' && setting.heading), false);

	const find = (node, predicate) => {
		if (predicate(node)) return node;
		for (const child of node.children) {
			const match = find(child, predicate);
			if (match) return match;
		}
		return undefined;
	};
	const textContent = node => (node.text ?? '') + node.children.map(textContent).join('');
	const topCallout = element.children[0];
	assert.equal(topCallout.cls, 'callout');
	assert.deepEqual(topCallout.attr, { 'data-callout': 'note' });
	assert.equal(find(topCallout, node => node.cls === 'callout-title-inner')?.text, 'Support');
	const supportParagraphs = find(topCallout, node => node.cls === 'callout-content')?.children;
	assert.deepEqual(supportParagraphs?.map(textContent), [
		'Found a problem? Report an issue',
		'Enjoying this plugin? Star on GitHub',
	]);

	const scopeCallout = element.children[1];
	assert.equal(scopeCallout.cls, 'callout');
	assert.deepEqual(scopeCallout.attr, { 'data-callout': 'note' });
	assert.equal(find(scopeCallout, node => node.cls === 'callout-title-inner')?.text, 'Where these settings apply');
	assert.equal(textContent(find(scopeCallout, node => node.cls === 'callout-content')),
		'Markdown notes in reading mode, including the switch back to editing, and base files when the experimental setting below is on.');
	assert.equal(element.children.length, 2);

	const anchors = [];
	const collectAnchors = node => {
		if (node.tag === 'a') anchors.push({ text: node.text, href: node.href });
		node.children.forEach(collectAnchors);
	};
	collectAnchors(element);
	assert.deepEqual(anchors, [
		{ text: 'Report an issue', href: 'https://github.com/DS-argus/vim-reading-nav/issues' },
		{ text: 'Star on GitHub', href: 'https://github.com/DS-argus/vim-reading-nav' },
	]);
});



test('legacy cursor placement is ignored in favor of the fixed 45% target without writing scroll', () => {
	const h = harness({ editCursorPlacement: 90 }), view = h.addPane(h.windows, { readingScroll: 50.75 });
	h.ready();
	const pixels = view.state.px;
	h.switchMode(view, 'source'); h.run();
	assert.deepEqual(cursorMoves(view), [['setCursor', point(55)]]);
	assert.deepEqual(scrollSetterCalls(view), []);
	assert.equal(view.state.px, pixels);
	assert.equal(view.state.sourceScroll, 0);
	assert.equal(h.settings.editCursorPlacement, 90);
});
test('source-to-preview leaves viewport management to Obsidian without moving the cursor', () => {
	const h = harness(), view = h.addPane(h.windows, {
		mode: 'source', readingScroll: 12.25, sourceScroll: 88.625,
	});
	h.ready();
	const pixels = view.state.px;
	h.switchMode(view, 'preview'); h.run();
	assert.deepEqual(cursorMoves(view), []);
	assert.deepEqual(scrollSetterCalls(view), []);
	assert.equal(view.state.px, pixels);
	assert.equal(view.state.readingScroll, 12.25);
	assert.equal(view.state.sourceScroll, 88.625);
});
test('a visible caret and selection are relocated to the fixed 45% row without scrolling', () => {
	const h = harness(), view = h.addPane(h.windows, {
		readingScroll: 50, head: point(52, 4), anchor: point(49, 2),
	});
	h.ready(); h.switchMode(view, 'source');
	const viewport = view.state.px;
	h.run();
	assert.deepEqual(cursorMoves(view), [['setCursor', point(54)]]);
	assert.deepEqual(view.state.head, point(54));
	assert.deepEqual(view.state.anchor, point(54));
	assert.equal(view.state.px, viewport);
	assert.deepEqual(scrollSetterCalls(view), []);
});

test('fixed 45% placement skips widgets downward without scrolling', () => {
	const v = geometry({ readingScroll: 50, widgetLines: { 53: 80 } });
	const before = v.state.px;
	const target = v.target();
	assert.equal(v.editor.offsetToPos(target).line, 54);
	assert.equal(v.state.px, before);
});

test('fixed 45% placement reaches ordinary text below a tall widget', () => {
	const v = geometry({ readingScroll: 50, height: 400, widgetLines: { 53: 220 } });
	const before = v.state.px;
	const target = v.target();
	assert.equal(v.editor.offsetToPos(target).line, 54);
	assert.equal(v.state.px, before);
});

test('fixed 45% placement returns none when no fully visible text follows a widget', () => {
	const v = geometry({ readingScroll: 50, widgetLines: { 53: 500 } });
	const before = v.state.px;
	assert.equal(v.target(), 'none');
	assert.equal(v.state.px, before);
});

test('wrapped rows with short glyph boxes remain valid placement targets', () => {
	const v = geometry({
		readingScroll: 49, rowHeights: { 53: 40 }, shortGlyphs: { 53: { topOffset: 18, height: 4 } },
	});
	const before = v.state.px;
	const target = v.target();
	assert.equal(v.editor.offsetToPos(target).line, 53);
	assert.equal(v.state.px, before);
});


test('cursor placement and mode tracking stay independent across same-file panes', () => {
	const h = harness();
	const left = h.addPane(h.windows, { readingScroll: 21.375 });
	const right = h.addPane(h.windows, { readingScroll: 94.625 });
	h.ready();
	h.switchMode(left, 'source'); h.switchMode(right, 'source'); h.run();
	assert.deepEqual(cursorMoves(left), [['setCursor', point(25)]]);
	assert.deepEqual(cursorMoves(right), [['setCursor', point(99)]]);
	assert.deepEqual(scrollSetterCalls(left), []);
	assert.deepEqual(scrollSetterCalls(right), []);
	h.switchMode(left, 'preview'); h.switchMode(right, 'preview'); h.run();
	assert.equal(cursorMoves(left).length, 1);
	assert.equal(cursorMoves(right).length, 1);
	assert.deepEqual(scrollSetterCalls(left), []);
	assert.deepEqual(scrollSetterCalls(right), []);
});
test('pop-out frames stay isolated; closing one window cancels only its cursor placement', () => {
	const h = harness(), main = h.addPane(h.windows, { readingScroll: 15.5 });
	const popout = windowFixture(); h.manager.registerTo(popout.doc);
	const detached = h.addPane(popout, { readingScroll: 81.25 });
	h.ready();
	h.switchMode(main, 'source'); h.switchMode(detached, 'source');
	assert.equal(h.windows.frames.size, 1);
	assert.equal(popout.frames.size, 1);
	h.workspace.emit('window-close', { doc: popout.doc }, popout.win);
	assert.equal(popout.frames.size, 0);
	h.run(); popout.flush();
	assert.deepEqual(scrollSetterCalls(main), []);
	assert.deepEqual(scrollSetterCalls(detached), []);
	assert.equal(cursorMoves(main).length, 1);
	assert.equal(cursorMoves(detached).length, 0);
});
test('rapid reversal and unload cancel pending work without changing scroll', () => {
	const h = harness(), view = h.addPane(h.windows, { readingScroll: 35.25 });
	h.ready(); h.switchMode(view, 'source');
	h.switchMode(view, 'preview');
	assert.equal(h.windows.frames.size, 0);
	h.run(3);
	assert.deepEqual(cursorMoves(view), []);
	assert.equal(view.state.readingScroll, 35.25);

	h.switchMode(view, 'source');
	const pixels = view.state.px;
	h.unload();
	assert.equal(h.windows.frames.size, 0);
	h.run();
	assert.deepEqual(cursorMoves(view), []);
	assert.equal(view.state.px, pixels);
	assert.deepEqual(scrollSetterCalls(view), []);
});
test('user interaction cancels pending cursor placement without writing scroll', () => {
	const h = harness(), view = h.addPane(h.windows, { readingScroll: 50 });
	h.ready(); h.switchMode(view, 'source');
	h.setScroll(view, 'source', 46.375);
	h.interact(view, 'wheel');
	h.run();
	assert.deepEqual(scrollSetterCalls(view), []);
	assert.deepEqual(cursorMoves(view), []);
	assert.equal(view.state.sourceScroll, 46.375);
});
test('external viewport changes are never reasserted on a later mode switch', () => {
	const h = harness(), view = h.addPane(h.windows, { readingScroll: 50 });
	h.ready(); h.switchMode(view, 'source'); h.run();
	const calls = [...view.calls];
	h.setScroll(view, 'source', 7.375);
	h.workspace.emit('layout-change'); h.run(PLACEMENT_FRAME_LIMIT);
	assert.deepEqual(view.calls, calls);
	assert.equal(view.state.px, view.pixelsForScroll(7.375));
	h.switchMode(view, 'preview'); h.run();
	assert.deepEqual(view.calls, calls);
	assert.deepEqual(scrollSetterCalls(view), []);
});
test('pending placement cancels when the user changes selection before the frame', () => {
	const h = harness(), view = h.addPane(h.windows, { readingScroll: 50 });
	h.ready(); h.switchMode(view, 'source');
	const pixels = view.state.px;
	view.state.head = point(3); view.state.anchor = point(3);
	h.run();
	assert.deepEqual(cursorMoves(view), []);
	assert.equal(view.state.px, pixels);
	assert.deepEqual(scrollSetterCalls(view), []);
});

test('file changes cancel pending cursor placement', () => {
	const h = harness(), view = h.addPane(h.windows, { readingScroll: 50 });
	h.ready(); h.switchMode(view, 'source');
	view.view.file = { path: 'other.md' };
	h.workspace.emit('file-open'); h.run();
	assert.deepEqual(cursorMoves(view), []);
	assert.deepEqual(scrollSetterCalls(view), []);
});
