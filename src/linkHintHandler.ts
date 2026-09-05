import { MarkdownView } from 'obsidian';
import type VimReadingNavPlugin from './main';
import { FootnoteResolver } from './footnoteResolver';
import { LinkPreviewSession, parseHttpUrl } from './linkPreviewSession';
import { getPreviewViewIn, getScrollElement, isFocusInModal } from './viewUtils';

const HINT_CHARS = 'asdfghjklqwertyuiopzxcvbnm';
const FOOTNOTE_REFERENCE_SELECTOR = 'a.footnote-link, sup.footnote-ref > a';

interface Hint {
	label: string;
	link: HTMLAnchorElement;
	el: HTMLElement;
	sourcePath: string;
}

interface DocumentState {
	hints: Hint[];
	typed: string;
	active: boolean;
	session: LinkPreviewSession;
}

/** Vimium-style link hint mode for reading mode. */
export class LinkHintHandler {
	private readonly footnotes: FootnoteResolver;
	private readonly states = new Map<Document, DocumentState>();

	constructor(private readonly plugin: VimReadingNavPlugin) {
		this.footnotes = new FootnoteResolver(plugin.app);
	}

	register(): void {
		this.footnotes.register(this.plugin);
		this.plugin.registerEvent(this.plugin.app.workspace.on('active-leaf-change', (leaf) => {
			const doc = leaf?.view.containerEl.ownerDocument;
			if (doc) this.resetDocument(doc);
		}));
		this.plugin.registerEvent(this.plugin.app.workspace.on('layout-change', () => this.reapInvalidStates()));
		this.plugin.registerEvent(this.plugin.app.workspace.on('window-close', (win) => this.disposeDocument(win.doc)));
		this.plugin.register(() => this.cleanup());
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView && leaf.view.getMode() === 'preview') {
				void leaf.view.previewMode.rerender(true);
			}
		});
	}

	registerTo(doc: Document): void {
		this.stateFor(doc);
		this.plugin.registerDomEvent(doc, 'keydown', (evt: KeyboardEvent) => this.handleKeyDown(evt, doc));
		this.plugin.registerDomEvent(doc, 'scroll', () => {
			const state = this.stateFor(doc);
			if (state.active) this.exitHintMode(state);
		}, { capture: true });
		const win = doc.defaultView;
		if (win) this.plugin.registerDomEvent(win, 'resize', () => {
			const state = this.stateFor(doc);
			if (state.active) this.exitHintMode(state);
			state.session.resize();
		});
	}

	cleanup(): void {
		for (const state of this.states.values()) this.disposeState(state);
		this.states.clear();
	}

	private handleKeyDown(evt: KeyboardEvent, doc: Document): void {
		if (isFocusInModal(evt, doc)) return;
		const state = this.stateFor(doc);
		if (state.active) {
			this.handleHintKey(evt, doc, state);
			return;
		}
		if (state.session.handleKey(evt)) return;
		const view = getPreviewViewIn(this.plugin.app, doc);
		if (!view || evt.ctrlKey || evt.metaKey || evt.altKey || evt.key !== 'f') return;
		this.consume(evt);
		this.enterHintMode(view, doc, state);
	}

	private enterHintMode(view: MarkdownView, doc: Document, state: DocumentState): void {
		this.resetState(state);
		const scrollEl = getScrollElement(view);
		const sourcePath = view.file?.path;
		if (!scrollEl || !sourcePath) return;
		const links = this.getVisibleLinks(scrollEl);
		if (links.length === 0) return;
		const labels = this.generateLabels(links.length);
		state.active = true;
		links.forEach((link, index) => {
			const label = labels[index];
			if (label) state.hints.push({ label, link, el: this.createHintEl(label, link, doc), sourcePath });
		});
	}

	private handleHintKey(evt: KeyboardEvent, doc: Document, state: DocumentState): void {
		if (evt.ctrlKey || evt.metaKey || evt.altKey) return this.exitHintMode(state);
		this.consume(evt);
		if (evt.key === 'Escape') return this.exitHintMode(state);
		if (evt.key === 'Backspace') {
			state.typed = state.typed.slice(0, -1);
			return this.updateHintDisplay(state);
		}
		if (evt.key.length !== 1 || !HINT_CHARS.includes(evt.key.toLowerCase())) return;
		state.typed += evt.key.toLowerCase();
		const matches = state.hints.filter((hint) => hint.label.startsWith(state.typed));
		if (matches.length === 0) return this.exitHintMode(state);
		const exact = matches.find((hint) => hint.label === state.typed);
		if (exact && matches.length === 1) {
			this.exitHintMode(state);
			this.selectHint(doc, state, exact);
			return;
		}
		this.updateHintDisplay(state);
	}

	private selectHint(doc: Document, state: DocumentState, hint: Hint): void {
		if (!hint.link.isConnected || hint.link.ownerDocument !== doc) return;
		state.session.focusHint(hint.link, hint.sourcePath, this.footnotes.get(hint.link));
	}

	private resetState(state: DocumentState): void {
		this.exitHintMode(state);
		state.session.reset();
	}

	private disposeState(state: DocumentState): void {
		this.exitHintMode(state);
		state.session.dispose();
	}

	private exitHintMode(state: DocumentState): void {
		state.hints.forEach((hint) => hint.el.remove());
		state.hints = [];
		state.typed = '';
		state.active = false;
	}

	private updateHintDisplay(state: DocumentState): void {
		state.hints.forEach((hint) => hint.el.toggleClass('vim-reading-nav-hint-inactive', !hint.label.startsWith(state.typed)));
	}

	private resetDocument(doc: Document): void {
		const state = this.states.get(doc);
		if (state) this.resetState(state);
	}

	private disposeDocument(doc: Document): void {
		const state = this.states.get(doc);
		if (!state) return;
		this.disposeState(state);
		this.states.delete(doc);
	}

	private reapInvalidStates(): void {
		for (const [doc, state] of this.states) {
			if (doc.defaultView?.closed) {
				this.disposeDocument(doc);
				continue;
			}
			if (state.active && state.hints.some((hint) => !hint.link.isConnected || hint.link.ownerDocument !== doc)) {
				this.exitHintMode(state);
			}
			state.session.reapInvalid();
		}
	}

	private stateFor(doc: Document): DocumentState {
		let state = this.states.get(doc);
		if (!state) {
			state = { hints: [], typed: '', active: false, session: new LinkPreviewSession(this.plugin, this.footnotes, doc) };
			this.states.set(doc, state);
		}
		return state;
	}

	private getVisibleLinks(scrollEl: HTMLElement): HTMLAnchorElement[] {
		const links = new Set(Array.from(scrollEl.querySelectorAll<HTMLAnchorElement>(
			'a.internal-link, a.external-link, a[href], ' + FOOTNOTE_REFERENCE_SELECTOR,
		)));
		const bounds = scrollEl.getBoundingClientRect();
		return Array.from(links).filter((link) => {
			if (link.closest('.markdown-embed')) return false;
			if (link.matches(FOOTNOTE_REFERENCE_SELECTOR)) return this.footnotes.get(link) !== undefined && this.isVisible(link, bounds);
			if (link.classList.contains('internal-link')) return this.isVisible(link, bounds);
			return parseHttpUrl(link.getAttribute('href')) !== null && this.isVisible(link, bounds);
		});
	}

	private isVisible(link: HTMLAnchorElement, bounds: DOMRect): boolean {
		const rect = link.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom;
	}

	private createHintEl(label: string, link: HTMLAnchorElement, doc: Document): HTMLElement {
		const rect = link.getBoundingClientRect();
		const el = doc.body.createSpan({ cls: 'vim-reading-nav-hint', text: label.toUpperCase() });
		el.style.left = `${rect.left}px`;
		el.style.top = `${rect.top + rect.height / 2}px`;
		return el;
	}

	private generateLabels(count: number): string[] {
		const chars = HINT_CHARS.split('');
		if (count <= chars.length) return chars.slice(0, count);
		const labels: string[] = [];
		for (const first of chars) for (const second of chars) {
			labels.push(first + second);
			if (labels.length >= count) return labels;
		}
		return labels;
	}

	private consume(evt: KeyboardEvent): void {
		evt.preventDefault();
		evt.stopImmediatePropagation();
	}
}
