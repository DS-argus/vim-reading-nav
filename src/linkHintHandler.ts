import { MarkdownView } from 'obsidian';
import type VimReadingNavPlugin from './main';
import { FootnoteResolver } from './footnoteResolver';
import { HintOverlay } from './hintModes';
import type { HintMode, HintModes } from './hintModes';
import {
	collectVisibleLinkHintTargets,
	createHintElement,
	hintTargetElement,
} from './markdownEmbedHints';
import { LinkPreviewSession } from './linkPreviewSession';
import type { LinkHintTarget } from './linkPreviewSession';
import { bindingMatchesEvent } from './settings';
import { consumeKey, getPreviewViewIn, getScrollElement, isFocusInModal, isLiveIn } from './viewUtils';

const TRIGGER_KEY = 'f';

interface DocumentState {
	hints: HintOverlay<LinkHintTarget>;
	/** The focused link and its preview. They outlive the hints that chose them. */
	session: LinkPreviewSession;
}

/** Vimium-style link hint mode for reading mode. */
export class LinkHintHandler implements HintMode {
	private readonly footnotes: FootnoteResolver;
	private readonly states = new Map<Document, DocumentState>();

	constructor(private readonly plugin: VimReadingNavPlugin, private readonly modes: HintModes) {
		this.footnotes = new FootnoteResolver(plugin.app);
		modes.add(this);
	}

	register(): void {
		const { workspace } = this.plugin.app;
		this.footnotes.register(this.plugin);
		this.plugin.registerEvent(workspace.on('active-leaf-change', (leaf) => {
			const doc = leaf?.view.containerEl.ownerDocument;
			if (!doc) return;
			const state = this.stateFor(doc);
			// Opening a split moves focus to the new pane; that must not drop the link being opened.
			if (!state.session.isOpeningSplit()) this.resetState(state);
		}));
		this.plugin.registerEvent(workspace.on('layout-change', () => this.reapInvalidStates()));
		this.plugin.registerEvent(workspace.on('window-close', (win) => this.disposeDocument(win.doc)));
		this.plugin.register(() => this.cleanup());
		// Re-render open reading views so footnote links already on screen get resolved.
		workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView && leaf.view.getMode() === 'preview') {
				void leaf.view.previewMode.rerender(true);
			}
		});
	}

	registerTo(doc: Document): void {
		this.stateFor(doc);
		this.plugin.registerDomEvent(doc, 'keydown', (evt: KeyboardEvent) => this.handleKeyDown(evt, doc));
		this.plugin.registerDomEvent(doc, 'keydown', (evt: KeyboardEvent) => {
			this.cancelPendingForConfiguredScroll(evt, doc);
		}, true);
		// Badges sit at fixed viewport positions, so scrolling or resizing leaves them misplaced.
		this.plugin.registerDomEvent(doc, 'scroll', () => this.stateFor(doc).hints.close(), { capture: true });
		const win = doc.defaultView;
		if (win) this.plugin.registerDomEvent(win, 'resize', () => {
			const state = this.stateFor(doc);
			state.hints.close();
			state.session.resize();
		});
	}

	isActive(doc: Document): boolean {
		return this.states.get(doc)?.hints.isShowing() ?? false;
	}

	/** Closes the hints only; a focused link and its preview stay. */
	closeHints(doc: Document): void {
		this.states.get(doc)?.hints.close();
	}

	settingsChanged(): void {
		for (const state of this.states.values()) this.resetState(state);
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
			if (target && isLiveIn(hintTargetElement(target), doc)) state.session.focusHint(target);
			return;
		}
		// Another mode's hints own every key, even while a link stays focused.
		if (this.modes.isShowing(doc)) return;
		// A focused link answers its own keys first: Enter, Esc, y, and the split keys.
		if (state.session.handleKey(evt)) return;
		const view = getPreviewViewIn(this.plugin.app, doc);
		if (!view || evt.ctrlKey || evt.metaKey || evt.altKey || evt.key !== TRIGGER_KEY) return;
		consumeKey(evt);
		if (!evt.repeat) this.showHints(view, doc, state);
	}

	/** Page scrolling cancels a pending split direction, so a stale `v` cannot fire later. */
	private cancelPendingForConfiguredScroll(evt: KeyboardEvent, doc: Document): void {
		if (isFocusInModal(evt, doc) || !getPreviewViewIn(this.plugin.app, doc)) return;
		const settings = this.plugin.settings;
		if (!bindingMatchesEvent(settings.halfPageDown, evt)
			&& !bindingMatchesEvent(settings.halfPageUp, evt)
			&& !bindingMatchesEvent(settings.fullPageDown, evt)
			&& !bindingMatchesEvent(settings.fullPageUp, evt)) return;
		this.stateFor(doc).session.cancelPendingDirection();
	}

	private showHints(view: MarkdownView, doc: Document, state: DocumentState): void {
		// Choosing a new link replaces the focused one, so its preview closes now.
		this.resetState(state);
		const scrollEl = getScrollElement(view);
		const sourcePath = view.file?.path;
		if (!scrollEl || !sourcePath) return;
		const targets = collectVisibleLinkHintTargets(scrollEl, this.plugin.app, sourcePath, this.footnotes);
		const bounds = scrollEl.getBoundingClientRect();
		state.hints.show(targets, (label, target) => createHintElement(label, target, doc, bounds));
	}

	private resetState(state: DocumentState): void {
		state.hints.close();
		state.session.reset();
	}

	private disposeState(state: DocumentState): void {
		state.hints.close();
		state.session.dispose();
	}

	private disposeDocument(doc: Document): void {
		const state = this.states.get(doc);
		if (!state) return;
		this.disposeState(state);
		this.states.delete(doc);
	}

	/** After a layout change, drop closed windows, hints on re-rendered links, and a stale focus. */
	private reapInvalidStates(): void {
		for (const [doc, state] of this.states) {
			if (doc.defaultView?.closed) {
				this.disposeDocument(doc);
				continue;
			}
			if (state.hints.targets().some((target) => !isLiveIn(hintTargetElement(target), doc))) state.hints.close();
			state.session.reapInvalid();
		}
	}

	private stateFor(doc: Document): DocumentState {
		let state = this.states.get(doc);
		if (!state) {
			state = { hints: new HintOverlay(), session: new LinkPreviewSession(this.plugin, this.footnotes, doc) };
			this.states.set(doc, state);
		}
		return state;
	}
}
