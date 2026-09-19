import { Component, MarkdownView } from 'obsidian';
import type { App, TFile, WorkspaceLeaf } from 'obsidian';
import { getScrollElement } from './viewUtils';

/** Retain a navigation's native subpath through initial mounting, remounts and section sizing. */
export class SubpathAlignment extends Component {
	constructor(
		private readonly app: App,
		private readonly leaf: WorkspaceLeaf,
		private readonly file: TFile,
		private readonly subpath: string,
		private readonly release: () => void,
	) { super(); }

	onload(): void {
		const view = this.leaf.view;
		const container = view.containerEl;
		const doc = container.ownerDocument;
		const win = doc.defaultView;
		if (!(view instanceof MarkdownView) || !win) { this.release(); return; }
		let stopped = false;
		let frame: number | null = null;
		let root: HTMLElement | null = null;
		let sizer: HTMLElement | null = null;
		// The destination owns this operation, not its replaceable rendered DOM.
		const valid = (): boolean => this.leaf.view === view && view.containerEl === container
			&& view.file === this.file && view.getMode() === 'preview'
			&& container.isConnected && container.ownerDocument === doc && !win.closed
			&& this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf === this.leaf;
		const stop = (): void => { if (!stopped) this.release(); };
		const queue = (): void => {
			if (!stopped && frame === null) frame = win.requestAnimationFrame(apply);
		};
		const resize = new win.ResizeObserver(queue);
		const observed = new Set<Element>();
		const observeSections = (): void => {
			if (!sizer) return;
			for (const child of observed) {
				if (child.parentElement !== sizer) { resize.unobserve(child); observed.delete(child); }
			}
			for (const child of Array.from(sizer.children)) {
				if (!observed.has(child)) { resize.observe(child); observed.add(child); }
			}
		};
		const bindLayout = (): boolean => {
			const candidate = getScrollElement(view);
			const content = candidate?.querySelector<HTMLElement>('.markdown-preview-sizer');
			const ready = candidate?.isConnected && content?.isConnected;
			const nextRoot = ready ? candidate : null;
			const nextSizer = ready ? content : null;
			if (root === nextRoot && sizer === nextSizer) return false;
			resize.disconnect();
			observed.clear();
			root = nextRoot;
			sizer = nextSizer;
			if (root && sizer) {
				resize.observe(root);
				resize.observe(sizer);
				observeSections();
			}
			return true;
		};
		const apply = (): void => {
			frame = null;
			if (stopped) return;
			if (!valid()) { stop(); return; }
			bindLayout();
			if (root && sizer) this.leaf.setEphemeralState({ subpath: this.subpath });
		};
		const mutation = new win.MutationObserver((records) => {
			if (stopped) return;
			if (!valid()) { stop(); return; }
			const changed = bindLayout();
			// Ignore highlight mutations inside sections: reapplying them must not loop.
			if (changed || records.some(record => record.target === sizer)) {
				observeSections();
				queue();
			}
		});
		this.register(() => {
			stopped = true;
			if (frame !== null) win.cancelAnimationFrame(frame);
			resize.disconnect();
			mutation.disconnect();
			observed.clear();
			root = null;
			sizer = null;
		});
		// Install cancellation before waiting for DOM, including cold first opens.
		for (const event of ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const) {
			this.registerDomEvent(doc, event, stop, { capture: true, passive: true });
		}
		const check = (): void => {
			if (stopped) return;
			if (!valid()) { stop(); return; }
			if (bindLayout()) queue();
		};
		this.registerEvent(this.app.workspace.on('active-leaf-change', check));
		this.registerEvent(this.app.workspace.on('layout-change', check));
		this.registerDomEvent(win, 'pagehide', stop);
		mutation.observe(container, { childList: true, subtree: true });
		if (!valid()) { stop(); return; }
		bindLayout();
		// Request native navigation once even before DOM exists, then resume on mount.
		this.leaf.setEphemeralState({ subpath: this.subpath });
	}
}
