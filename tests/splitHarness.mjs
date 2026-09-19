import { build } from 'esbuild';

// Bundle production session, navigator and event handler; replace only host/UI APIs.
const result = await build({
	stdin: { contents: `export { LinkHintHandler } from './src/linkHintHandler';
		export { MarkdownView, TFile, WorkspaceTabs } from 'obsidian';`, resolveDir: process.cwd() },
	bundle: true, write: false, format: 'esm', platform: 'node',
	plugins: [{ name: 'host-mocks', setup(build) {
		build.onResolve({ filter: /^(obsidian|\.\/persistentLinkPreview|\.\/footnoteResolver|\.\/settings|\.\/viewUtils)$/ }, args => ({ path: args.path, namespace: 'mock' }));
		build.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: {
			obsidian: `export class MarkdownView { getMode() { return this.mode ?? 'preview'; } }
				export class WorkspaceTabs {}
				export class Component {
					cleanups = [];
					register(fn) { this.cleanups.push(fn); }
					registerEvent() {} registerDomEvent() {}
					unload() { this.cleanups.splice(0).reverse().forEach(fn => fn()); }
				}
				export class TFile { constructor(path) { this.path = path; this.extension = 'md'; } }
				export function parseLinktext(text) { const i = text.indexOf('#'); return { path: i < 0 ? text : text.slice(0,i), subpath: i < 0 ? '' : text.slice(i) }; }
				export function resolveSubpath(cache, subpath) { return cache[subpath]; }`,
			'./persistentLinkPreview': `export class PersistentLinkPreview {
				setGuidance() {} reposition() {} close() { this.opened = false; }
				open() { this.opened = true; } isOpen() { return this.opened; }
				showOpenError(message) { this.error = message; }
			}`,
			'./footnoteResolver': 'export class FootnoteResolver { register() {} }',
			'./settings': 'export function bindingMatchesEvent() { return false; }',
			'./viewUtils': 'export function getPreviewViewIn() {} export function getScrollElement() {} export function isFocusInModal() { return false; }',
		}[path] }));
	} }],
});
const { LinkHintHandler, MarkdownView, TFile, WorkspaceTabs } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

export function harness({ adjacent = false, below = false, reflow = null, subpath = '', popout = false, embed = false, self = false } = {}) {
	const trace = [];
	class Observer { observe() {} disconnect() {} }
	const doc = { defaultView: { closed: false, setTimeout, clearTimeout, ResizeObserver: Observer, MutationObserver: Observer } };
	const sourceFile = new TFile('source.md');
	const targetFile = self ? sourceFile : new TFile('target.md');
	const otherFile = new TFile('other.md');
	const root = {}, container = {}, leaves = [], events = new Map();
	let session, active, target, finishOpen, failOpen;
	const emit = (event, value) => { trace.push(event); events.get(event)?.(value); };
	const rect = (left, top) => ({ left, top, right: left + 500, bottom: top + 500, width: 500, height: 500 });
	const group = (left, top) => Object.assign(new WorkspaceTabs(), { element: { ownerDocument: doc, getBoundingClientRect: () => rect(left, top) } });
	function leaf(parent, file) {
		const leaf = { parent, pinned: false, getRoot: () => root, getContainer: () => container,
			getViewState: () => ({ type: leaf.view.file ? 'markdown' : 'empty', pinned: leaf.pinned }),
			detach: () => { trace.push('detach'); leaves.splice(leaves.indexOf(leaf), 1); },
			openFile: async (file, state) => {
				trace.push('openFile'); leaf.view.file = file; leaf.openState = state;
				await new Promise((resolve, reject) => { leaf.complete = finishOpen = resolve; leaf.fail = failOpen = reject; });
			},
			loadIfDeferred: async () => { trace.push('loadIfDeferred'); },
			setEphemeralState: state => { leaf.ephemeral = state; trace.push('subpath'); },
		};
		leaf.view = Object.assign(new MarkdownView(), { leaf, file,
			previewMode: { rerender() {} },
			containerEl: { ownerDocument: doc, isConnected: true, contains: link => link.isConnected && link.ownerDocument === doc,
				getBoundingClientRect: () => parent.element.getBoundingClientRect(), closest: () => parent.element },
		});
		leaves.push(leaf);
		return leaf;
	}
	const source = leaf(group(0, 0), sourceFile);
	const neighbor = adjacent ? leaf(group(below ? 0 : 504, below ? 504 : 0), otherFile) : null;
	if (popout) {
		const mainLeaf = leaf(group(504, 0), otherFile);
		mainLeaf.view.containerEl.ownerDocument = {};
		mainLeaf.getRoot = () => ({});
		mainLeaf.getContainer = () => ({});
	}
	active = source;
	const embedElement = embed ? { nodeName: 'DIV', isConnected: true, ownerDocument: doc,
		classList: { contains: () => false }, addClass() {}, removeClass() {}, scrollIntoView() {},
		click() { trace.push(['native-embed-click', session.focusedTarget === null, !session.preview.isOpen()]); },
	} : null;
	const link = { isConnected: true, ownerDocument: doc, classList: { contains: () => true },
		getAttribute: () => `target${subpath}`, addClass() {}, removeClass() {}, scrollIntoView() {},
	};
	function replaceLink() { (embedElement ?? link).isConnected = false; trace.push('source DOM replaced'); }
	function created(parent, direction) {
		trace.push(`create:${direction}`);
		target = leaf(parent, null);
		if (reflow === 'create') replaceLink();
		emit('layout-change');
		return target;
	}
	const workspace = {
		on: (event, callback) => { events.set(event, callback); },
		iterateAllLeaves: callback => [...leaves].forEach(callback),
		getActiveViewOfType: () => active?.view,
		setActiveLeaf: (leaf, options) => { active = leaf; trace.push(options.focus ? 'focus' : 'activate'); emit('active-leaf-change', leaf); },
		createLeafBySplit: (_, direction) => created(group(direction === 'vertical' ? 504 : 0, direction === 'horizontal' ? 504 : 0), direction),
		getLeaf: () => created(active.parent, 'tab'),
		openLinkText: (...args) => { trace.push(['same-pane', ...args]); },
	};
	const plugin = { app: { workspace,
		vault: { getAbstractFileByPath: () => sourceFile },
		metadataCache: { getFirstLinkpathDest: () => targetFile, getFileCache: () => ({ '#heading': {}, '#^block': {} }) },
	}, settings: { enableSplitOpening: true, showPreviewOpeningGuidance: true },
	registerEvent() {}, register() {}, registerDomEvent() {},
	addChild(child) { child.onload(); return child; }, removeChild(child) { child.unload(); return child; },
	};
	const handler = new LinkHintHandler(plugin);
	handler.register();
	session = handler.stateFor(doc).session;
	const open = session.navigator.open.bind(session.navigator);
	let opening;
	session.navigator.open = (...args) => {
		opening = open(...args).then(result => { trace.push(result.opened ? 'opened' : result.cancelled ? 'cancelled' : 'error'); return result; });
		return opening;
	};
	session.focusHint({ kind: 'internal', element: embedElement ?? link, root: embedElement ?? undefined, linktext: `target${subpath}`, sourcePath: sourceFile.path });
	function key(key) {
		const event = { key, shiftKey: key === key.toUpperCase(), preventDefault() {}, stopImmediatePropagation() {} };
		return session.handleKey(event);
	}
	return { session, handler, source, neighbor, link, embed: embedElement, targetFile, otherFile, doc, leaves, trace, workspace,
		get target() { return target; }, get active() { return active; }, get opening() { return opening; },
		key, replaceLink, emit,
		start(keyName = 'v') { key(keyName); key('Enter'); },
		async settle(error) {
			if (error) failOpen?.(error); else finishOpen?.();
			const result = await opening;
			await Promise.resolve();
			return result;
		},
	};
}
