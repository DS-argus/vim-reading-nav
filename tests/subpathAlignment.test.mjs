import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const result = await build({
	stdin: { contents: `export { SubpathAlignment } from './src/subpathAlignment'; export { MarkdownView } from 'obsidian';`, resolveDir: process.cwd() },
	bundle: true, write: false, format: 'esm', platform: 'node',
	plugins: [{ name: 'host', setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
		build.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: `
			export class MarkdownView { getMode() { return this.mode; } }
			export class Component {
				cleanups = [];
				register(fn) { this.cleanups.push(fn); }
				registerEvent(ref) { this.register(() => ref.off()); }
				registerDomEvent(target, type, fn, options) {
					target.addEventListener(type, fn, options);
					this.register(() => target.removeEventListener(type, fn, options));
				}
				unload() { this.cleanups.splice(0).reverse().forEach(fn => fn()); }
			}
		` }));
	} }],
});
const { SubpathAlignment, MarkdownView } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

function fixture({ subpath = '#heading', missingRoot = false, missingSizer = false } = {}) {
	const frames = new Map(), events = new Map(), calls = [];
	let serial = 0, released = 0, resize, mutation;
	class Observer {
		observed = new Set();
		constructor(callback) { this.callback = callback; }
		observe(el) { this.disconnected = false; this.observed.add(el); }
		unobserve(el) { this.observed.delete(el); }
		disconnect() { this.disconnected = true; this.observed.clear(); }
	}
	const win = Object.assign(new EventTarget(), {
		closed: false,
		ResizeObserver: class extends Observer { constructor(fn) { super(fn); resize = this; } },
		MutationObserver: class extends Observer { constructor(fn) { super(fn); mutation = this; } },
		requestAnimationFrame(fn) { frames.set(++serial, fn); return serial; },
		cancelAnimationFrame(id) { frames.delete(id); },
	});
	const doc = Object.assign(new EventTarget(), { defaultView: win });
	let sizer = { isConnected: true, children: [] };
	const section = { parentElement: sizer };
	sizer.children.push(section);
	let root = { ownerDocument: doc, isConnected: true, scrollHeight: 1000, scrollTop: 0, querySelector: () => missingSizer ? null : sizer };
	const file = { path: 'target.md' };
	const view = Object.assign(new MarkdownView(), { mode: 'preview', file, containerEl: { isConnected: true, ownerDocument: doc, querySelector: () => missingRoot ? null : root } });
	const leaf = { view, setEphemeralState(state) { calls.push(state); root.scrollTop = root.scrollHeight - 300; } };
	view.leaf = leaf;
	let active = view;
	const app = { workspace: {
		getActiveViewOfType: () => active,
		on(name, fn) { events.set(name, fn); return { off: () => events.delete(name) }; },
	} };
	const alignment = new SubpathAlignment(app, leaf, file, subpath, () => { released++; alignment.unload(); });
	alignment.onload();
	return { get root() { return root; }, get sizer() { return sizer; }, section, leaf, view, doc, win, calls, alignment, frames,
		get resize() { return resize; }, get mutation() { return mutation; }, get released() { return released; },
		flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); },
		emit(name) { events.get(name)?.(); }, switchPane() { active = null; },
		mount(replacement) {
			if (replacement) {
				sizer.isConnected = false;
				sizer = { isConnected: true, children: [] };
				if (replacement === 'root') {
					root.isConnected = false;
					root = { ...root, isConnected: true, querySelector: () => sizer };
				}
			}
			missingRoot = false; missingSizer = false;
			mutation?.callback([{ target: view.containerEl }]);
		},
	};
}

for (const subpath of ['#heading', '#^block']) {
	test(`reapplies native ${subpath} after delayed section sizing without a timer`, () => {
		const h = fixture({ subpath });
		assert.deepEqual(h.calls, [{ subpath }]);
		h.root.scrollHeight = 2000;
		h.resize.callback(); h.resize.callback();
		assert.equal(h.frames.size, 1);
		h.flush();
		assert.equal(h.root.scrollTop, 1700);
		assert.deepEqual(h.calls, [{ subpath }, { subpath }]);
		assert.equal(h.frames.size, 0);
		h.alignment.unload();
	});
}

test('tracks new virtual sections but ignores highlight mutations inside sections', () => {
	const h = fixture();
	h.mutation.callback([{ target: h.section }]);
	assert.equal(h.frames.size, 0);
	const replacement = { parentElement: h.sizer };
	h.section.parentElement = null;
	h.sizer.children = [replacement];
	h.mutation.callback([{ target: h.sizer }]);
	assert.ok(h.resize.observed.has(replacement));
	assert.ok(!h.resize.observed.has(h.section));
	h.flush();
	assert.equal(h.calls.length, 2);
	h.alignment.unload();
});

for (const event of ['keydown', 'pointerdown', 'wheel', 'touchstart']) {
	test(`${event} stops correction before pending frames can move the user`, () => {
		const h = fixture();
		h.resize.callback();
		h.doc.dispatchEvent(new Event(event));
		h.flush(); h.resize.callback(); h.flush();
		assert.equal(h.calls.length, 1);
		assert.equal(h.released, 1);
		assert.ok(h.resize.disconnected && h.mutation.disconnected);
	});
}

for (const [name, change] of Object.entries({
	pane: h => h.switchPane(),
	file: h => { h.view.file = { path: 'other.md' }; },
	mode: h => { h.view.mode = 'source'; },
	view: h => { h.leaf.view = {}; },
	document: h => { h.view.containerEl.ownerDocument = {}; },
	container: h => { h.view.containerEl.isConnected = false; },
	window: h => { h.win.closed = true; },
})) {
	test(`${name} invalidation stops destination tracking`, () => {
		const h = fixture();
		h.resize.callback(); change(h); h.flush();
		assert.equal(h.calls.length, 1);
		assert.equal(h.released, 1);
	});
}

test('workspace changes and unload release observer and frame ownership', () => {
	const h = fixture();
	h.resize.callback(); h.switchPane(); h.emit('active-leaf-change');
	assert.equal(h.frames.size, 0);
	assert.ok(h.resize.disconnected);
	const other = fixture();
	other.resize.callback(); other.alignment.unload(); other.flush();
	assert.equal(other.calls.length, 1);
	assert.ok(other.mutation.disconnected);
});

for (const missing of ['missingRoot', 'missingSizer']) {
	test(`waits for ${missing} to mount before resuming native alignment`, () => {
		const h = fixture({ [missing]: true });
		assert.equal(h.released, 0);
		h.mount(); h.flush();
		assert.deepEqual(h.calls.at(-1), { subpath: '#heading' });
		assert.ok(h.resize.observed.has(h.root) && h.resize.observed.has(h.sizer));
		assert.equal(h.calls.length, 2);
		h.alignment.unload();
	});
}

for (const replacement of ['root', 'sizer']) {
	test(`rebinds a replaced ${replacement} within the same destination`, () => {
		const h = fixture();
		const oldRoot = h.root, oldSizer = h.sizer;
		h.resize.callback();
		h.mount(replacement); h.flush();
		assert.equal(h.released, 0);
		assert.equal(h.calls.length, 2);
		assert.ok(h.resize.observed.has(h.root) && h.resize.observed.has(h.sizer));
		assert.ok(!h.resize.observed.has(oldSizer));
		if (replacement === 'root') assert.ok(!h.resize.observed.has(oldRoot));
		h.alignment.unload();
	});
}

test('keeps waiting across temporary DOM removal and cancels on user intent', () => {
	const h = fixture();
	h.root.isConnected = false;
	h.mutation.callback([{ target: h.view.containerEl }]); h.flush();
	assert.equal(h.released, 0);
	assert.equal(h.calls.length, 1);
	h.doc.dispatchEvent(new Event('wheel'));
	h.mount('root'); h.flush();
	assert.equal(h.released, 1);
	assert.equal(h.calls.length, 1);
});

test('unloading while waiting prevents future mount corrections', () => {
	const h = fixture({ missingRoot: true });
	h.alignment.unload(); h.mount(); h.flush();
	assert.equal(h.calls.length, 1);
	assert.ok(h.mutation.disconnected && h.resize.disconnected);
});

for (const event of ['keydown', 'pointerdown', 'wheel', 'touchstart']) {
	test(`${event} while awaiting the first DOM prevents later alignment`, () => {
		const h = fixture({ missingRoot: true });
		h.doc.dispatchEvent(new Event(event));
		h.mount(); h.flush();
		assert.equal(h.released, 1);
		assert.equal(h.calls.length, 1);
		assert.equal(h.resize.observed.size, 0);
	});
}

test('a layout event can reconnect a late sizer without an extra DOM mutation', () => {
	const h = fixture({ missingSizer: true });
	h.root.querySelector = () => h.sizer;
	h.emit('layout-change'); h.flush();
	assert.equal(h.calls.length, 2);
	assert.equal(h.released, 0);
	h.alignment.unload();
});
