import { MarkdownView } from 'obsidian';
import type VimReadingNavPlugin from './main';
import { CopyFeedback, writeClipboard } from './clipboard';
import { collectVisibleCodeBlocks, createCodeBlockHintElement } from './codeBlockTargets';
import { HintOverlay } from './hintModes';
import type { HintMode, HintModes } from './hintModes';
import { collectVisibleInlineCode, createInlineCodeHintElement } from './inlineCodeTargets';
import { consumeKey, getPreviewViewIn, getScrollElement, isFocusInModal, isLiveIn } from './viewUtils';

type CopyKind = 'block' | 'inline';

const TRIGGER_KEYS = new Map<string, CopyKind>([['y', 'block'], ['Y', 'inline']]);

/** What one copy hint points at. */
interface CopyTarget {
	/** The element outlined after a successful copy. */
	el: HTMLElement;
	/** Resolves to whether the text reached the clipboard. */
	copy(): Promise<boolean>;
	createBadge(label: string): HTMLElement;
}

interface DocumentState {
	hints: HintOverlay<CopyTarget>;
	copied: CopyFeedback;
}

/**
 * Vimium-style copy hints for reading mode.
 *
 * - `y` copies a code block through Obsidian's own copy button, so the text
 *   matches a mouse click: the code body only, without fences or language.
 * - `Y` copies an inline code span. Obsidian has no button for these, so the
 *   rendered text is written to the clipboard directly.
 */
export class CodeCopyHintHandler implements HintMode {
	private readonly states = new Map<Document, DocumentState>();

	constructor(private readonly plugin: VimReadingNavPlugin, private readonly modes: HintModes) {
		modes.add(this);
	}

	register(): void {
		const { workspace } = this.plugin.app;
		// Hints belong to one pane, so moving to another pane closes them.
		this.plugin.registerEvent(workspace.on('active-leaf-change', () => this.closeAll()));
		this.plugin.registerEvent(workspace.on('layout-change', () => this.reapInvalidStates()));
		this.plugin.registerEvent(workspace.on('window-close', (win) => this.disposeDocument(win.doc)));
		this.plugin.register(() => this.cleanup());
	}

	registerTo(doc: Document): void {
		this.stateFor(doc);
		this.plugin.registerDomEvent(doc, 'keydown', (evt: KeyboardEvent) => this.handleKeyDown(evt, doc));
		// Badges sit at fixed viewport positions, so scrolling or resizing leaves them misplaced.
		this.plugin.registerDomEvent(doc, 'scroll', () => this.stateFor(doc).hints.close(), { capture: true });
		const win = doc.defaultView;
		if (win) this.plugin.registerDomEvent(win, 'resize', () => this.stateFor(doc).hints.close());
	}

	isActive(doc: Document): boolean {
		return this.states.get(doc)?.hints.isShowing() ?? false;
	}

	closeHints(doc: Document): void {
		this.states.get(doc)?.hints.close();
	}

	cleanup(): void {
		for (const state of this.states.values()) this.disposeState(state);
		this.states.clear();
	}

	private handleKeyDown(evt: KeyboardEvent, doc: Document): void {
		if (isFocusInModal(evt, doc)) return;
		const state = this.stateFor(doc);
		if (state.hints.isShowing()) {
			const target = state.hints.handleKey(evt);
			if (target) void this.copy(target, doc, state);
			return;
		}
		const kind = TRIGGER_KEYS.get(evt.key);
		// Another mode's hints own every key, these triggers included.
		if (!kind || evt.ctrlKey || evt.metaKey || evt.altKey || this.modes.isShowing(doc)) return;
		const view = getPreviewViewIn(this.plugin.app, doc);
		if (!view) return;
		consumeKey(evt);
		if (!evt.repeat) this.showHints(kind, view, doc, state);
	}

	private showHints(kind: CopyKind, view: MarkdownView, doc: Document, state: DocumentState): void {
		const scrollEl = getScrollElement(view);
		if (!scrollEl) return;
		const targets = kind === 'block' ? codeBlockTargets(scrollEl, doc) : inlineCodeTargets(scrollEl, doc);
		state.hints.show(targets, (label, target) => target.createBadge(label));
	}

	/** Outlines what was copied, since a code block's own check icon may be scrolled out of view. */
	private async copy(target: CopyTarget, doc: Document, state: DocumentState): Promise<void> {
		if (!isLiveIn(target.el, doc)) return;
		const copied = await target.copy();
		// The write may finish after the window closed or the plugin unloaded; outline nothing then.
		if (copied && target.el.isConnected && this.states.get(doc) === state) state.copied.show(target.el);
	}

	private closeAll(): void {
		for (const state of this.states.values()) state.hints.close();
	}

	private disposeState(state: DocumentState): void {
		state.hints.close();
		state.copied.clear();
	}

	private disposeDocument(doc: Document): void {
		const state = this.states.get(doc);
		if (!state) return;
		this.disposeState(state);
		this.states.delete(doc);
	}

	/** After a layout change, drop closed windows and hints whose code was re-rendered. */
	private reapInvalidStates(): void {
		for (const [doc, state] of this.states) {
			if (doc.defaultView?.closed) this.disposeDocument(doc);
			else if (state.hints.targets().some((target) => !isLiveIn(target.el, doc))) state.hints.close();
		}
	}

	private stateFor(doc: Document): DocumentState {
		let state = this.states.get(doc);
		if (!state) {
			state = { hints: new HintOverlay(), copied: new CopyFeedback() };
			this.states.set(doc, state);
		}
		return state;
	}
}

/** `y` targets: each block is copied by clicking the copy button Obsidian rendered on it. */
function codeBlockTargets(scrollEl: HTMLElement, doc: Document): CopyTarget[] {
	return collectVisibleCodeBlocks(scrollEl).map((block) => ({
		el: block.pre,
		copy: () => {
			// A re-render since the hints appeared replaces the button; never click a stale one.
			if (!block.button.isConnected || block.button.closest('pre') !== block.pre) return Promise.resolve(false);
			block.button.click();
			return Promise.resolve(true);
		},
		createBadge: (label) => createCodeBlockHintElement(label, block, doc),
	}));
}

/** `Y` targets: the span's code text, read when the hints appear, goes to the clipboard. */
function inlineCodeTargets(scrollEl: HTMLElement, doc: Document): CopyTarget[] {
	return collectVisibleInlineCode(scrollEl).map((inline) => ({
		el: inline.code,
		copy: () => writeClipboard(inline.text),
		createBadge: (label) => createInlineCodeHintElement(label, inline, doc),
	}));
}
