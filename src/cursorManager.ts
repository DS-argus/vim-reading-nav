import { MarkdownView } from 'obsidian';
import type { Editor, MarkdownViewModeType, Plugin } from 'obsidian';
import { placementTarget } from './cursorPlacement';
import type { EditorWithCM } from './types';

export const PLACEMENT_FRAME_LIMIT = 12;
interface TrackedView { mode: MarkdownViewModeType; path: string | null; }
interface Point { line: number; ch: number; }
interface Selection { anchor: Point; head: Point; }
interface TransitionTask {
	readonly win: Window;
	readonly doc: Document;
	readonly container: HTMLElement;
	readonly path: string;
	readonly mode: MarkdownViewModeType;
	selection: Selection[] | null;
	frame: number | null;
	frames: number;
}

function selectionSnapshot(editor: Editor): Selection[] {
	return editor.listSelections().map(({ anchor, head }) => ({
		anchor: { line: anchor.line, ch: anchor.ch },
		head: { line: head.line, ch: head.ch },
	}));
}

function sameSelection(a: Selection[], b: Selection[]): boolean {
	return a.length === b.length && a.every((selection, index) => {
		const other = b[index];
		return !!other && selection.anchor.line === other.anchor.line && selection.anchor.ch === other.anchor.ch
			&& selection.head.line === other.head.line && selection.head.ch === other.head.ch;
	});
}

export class CursorManager {
	private readonly tracked = new WeakMap<MarkdownView, TrackedView>();
	private readonly tasks = new Map<MarkdownView, TransitionTask>();
	private ready = false;

	constructor(private readonly plugin: Plugin) {}

	register(): void {
		const workspace = this.plugin.app.workspace;
		workspace.onLayoutReady(() => {
			this.ready = true;
			for (const view of this.views()) {
				this.tracked.set(view, { mode: view.getMode(), path: view.file?.path ?? null });
			}
		});
		this.plugin.registerEvent(workspace.on('layout-change', () => this.sync()));
		this.plugin.registerEvent(workspace.on('active-leaf-change', () => this.sync()));
		this.plugin.registerEvent(workspace.on('file-open', () => this.sync()));
		this.plugin.registerEvent(workspace.on('window-close', (_, win) => {
			for (const [view, task] of this.tasks) if (task.win === win) this.drop(view, task);
		}));
		this.plugin.register(() => {
			this.ready = false;
			for (const [view, task] of this.tasks) this.drop(view, task);
		});
	}

	registerTo(doc: Document): void {
		for (const type of ['wheel', 'touchmove', 'pointerdown', 'keydown'] as const) {
			this.plugin.registerDomEvent(doc, type, (event) => this.cancelOnInteraction(event), { capture: true, passive: true });
		}
	}

	private cancelOnInteraction(event: Event): void {
		const target = event.target;
		if (!target || !('nodeType' in target)) return;
		for (const [view, task] of this.tasks) {
			if (task.container.contains(target as Node)) this.drop(view, task);
		}
	}

	private views(): MarkdownView[] {
		const views: MarkdownView[] = [];
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) views.push(leaf.view);
		});
		return views;
	}

	private sync(): void {
		if (!this.ready) return;
		for (const [view, task] of this.tasks) if (!this.isOwned(view, task)) this.drop(view, task);
		for (const view of this.views()) this.syncView(view);
	}

	private syncView(view: MarkdownView): void {
		const mode = view.getMode(), path = view.file?.path ?? null, previous = this.tracked.get(view);
		if (!previous) {
			this.tracked.set(view, { mode, path });
			return;
		}

		const previousMode = previous.mode, previousPath = previous.path;
		previous.mode = mode;
		previous.path = path;
		if (path !== previousPath) {
			this.drop(view);
			return;
		}
		if (mode === previousMode) return;

		this.drop(view);
		if (previousMode === 'preview' && mode === 'source' && path) this.startTransition(view, path, mode);
	}

	private startTransition(view: MarkdownView, path: string, mode: MarkdownViewModeType): void {
		const container = view.containerEl, doc = container.ownerDocument, win = doc.defaultView;
		if (!win) return;
		const editor = view.editor as EditorWithCM | undefined;
		const task: TransitionTask = {
			win, doc, container, path, mode,
			selection: editor ? selectionSnapshot(editor) : null,
			frame: null, frames: 0,
		};
		this.tasks.set(view, task);
		this.queue(view, task);
	}

	private transitionStep(view: MarkdownView, task: TransitionTask): void {
		if (!this.isOwned(view, task)) { this.drop(view, task); return; }
		const editor = view.editor as EditorWithCM | undefined;
		if (editor && task.selection && !sameSelection(task.selection, selectionSnapshot(editor))) {
			this.drop(view, task);
			return;
		}

		task.frames++;
		if (!editor?.cm) { this.retryOrDrop(view, task); return; }
		if (!task.selection) task.selection = selectionSnapshot(editor);
		else if (!sameSelection(task.selection, selectionSnapshot(editor))) { this.drop(view, task); return; }

		const target = placementTarget(editor.cm);
		if (target === 'wait') { this.retryOrDrop(view, task); return; }
		if (typeof target === 'number') editor.setCursor(editor.offsetToPos(target));
		this.drop(view, task);
	}

	private retryOrDrop(view: MarkdownView, task: TransitionTask): void {
		if (task.frames >= PLACEMENT_FRAME_LIMIT) this.drop(view, task);
		else this.queue(view, task);
	}

	private isOwned(view: MarkdownView, task: TransitionTask): boolean {
		return view.leaf.view === view && view.containerEl === task.container && task.container.isConnected
			&& task.container.ownerDocument === task.doc && !task.win.closed && view.file?.path === task.path
			&& view.getMode() === task.mode;
	}

	private drop(view: MarkdownView, task = this.tasks.get(view)): void {
		if (!task) return;
		if (this.tasks.get(view) === task) this.tasks.delete(view);
		if (task.frame !== null) task.win.cancelAnimationFrame(task.frame);
		task.frame = null;
	}

	private queue(view: MarkdownView, task: TransitionTask): void {
		task.frame = task.win.requestAnimationFrame(() => {
			task.frame = null;
			if (this.tasks.get(view) === task) this.transitionStep(view, task);
		});
	}
}
