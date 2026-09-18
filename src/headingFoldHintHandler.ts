import { MarkdownView } from 'obsidian';
import type VimReadingNavPlugin from './main';
import { getPreviewViewIn, getScrollElement, isFocusInModal } from './viewUtils';

const HINT_CHARS = 'asdfghjklqwertyuiopzxcvbnm';
const HINT_CLASS = 'vim-reading-nav-heading-hint';
const HINT_INACTIVE_CLASS = 'vim-reading-nav-hint-inactive';

interface Hint {
	label: string;
	heading: HTMLHeadingElement;
	el: HTMLElement;
}

interface DocumentState {
	hints: Hint[];
	typed: string;
	active: boolean;
}

/** Vimium-style heading fold hints for reading mode. */
export class HeadingFoldHintHandler {
	private readonly states = new Map<Document, DocumentState>();

	constructor(private readonly plugin: VimReadingNavPlugin) {}

	register(): void {
		this.plugin.registerEvent(this.plugin.app.workspace.on('active-leaf-change', () => this.exitAllHintModes()));
		this.plugin.registerEvent(this.plugin.app.workspace.on('layout-change', () => this.reapInvalidStates()));
		this.plugin.registerEvent(this.plugin.app.workspace.on('window-close', (win) => this.disposeDocument(win.doc)));
		this.plugin.register(() => this.cleanup());
	}

	registerTo(doc: Document): void {
		this.stateFor(doc);
		this.plugin.registerDomEvent(doc, 'keydown', (evt: KeyboardEvent) => this.handleKeyDown(evt, doc));
		this.plugin.registerDomEvent(doc, 'scroll', () => this.exitHintMode(this.stateFor(doc)), { capture: true });
		const win = doc.defaultView;
		if (win) this.plugin.registerDomEvent(win, 'resize', () => this.exitHintMode(this.stateFor(doc)));
	}

	cleanup(): void {
		for (const state of this.states.values()) this.exitHintMode(state);
		this.states.clear();
	}

	private handleKeyDown(evt: KeyboardEvent, doc: Document): void {
		if (isFocusInModal(evt, doc)) return;
		const state = this.stateFor(doc);
		if (state.active) {
			this.handleHintKey(evt, doc, state);
			return;
		}
		if (evt.ctrlKey || evt.metaKey || evt.altKey || evt.key !== 'F') return;
		const view = getPreviewViewIn(this.plugin.app, doc);
		if (!view) return;
		this.consume(evt);
		this.enterHintMode(view, doc, state);
	}

	private enterHintMode(view: MarkdownView, doc: Document, state: DocumentState): void {
		this.exitHintMode(state);
		const scrollEl = getScrollElement(view);
		if (!scrollEl) return;
		const headings = this.getVisibleHeadings(scrollEl);
		if (headings.length === 0) return;
		state.active = true;
		const labels = this.generateLabels(headings.length);
		headings.forEach((heading, index) => {
			const label = labels[index];
			if (label) state.hints.push({ label, heading, el: this.createHintEl(label, heading, doc) });
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
		if (evt.key.length !== 1 || !HINT_CHARS.includes(evt.key.toLowerCase())) return this.exitHintMode(state);
		state.typed += evt.key.toLowerCase();
		const matches = state.hints.filter((hint) => hint.label.startsWith(state.typed));
		if (matches.length === 0) return this.exitHintMode(state);
		const exact = matches.find((hint) => hint.label === state.typed);
		if (exact && matches.length === 1) {
			this.exitHintMode(state);
			this.toggleSection(exact.heading, doc);
			return;
		}
		this.updateHintDisplay(state);
	}

	private toggleSection(heading: HTMLHeadingElement, doc: Document): void {
		if (!heading.isConnected || heading.ownerDocument !== doc) return;
		const indicator = heading.querySelector<HTMLElement>(':scope > .heading-collapse-indicator');
		if (!indicator?.isConnected || indicator.ownerDocument !== doc) return;
		indicator.click();
	}

	private getVisibleHeadings(scrollEl: HTMLElement): HTMLHeadingElement[] {
		const bounds = scrollEl.getBoundingClientRect();
		return Array.from(scrollEl.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6')).filter((heading) => {
			if (heading.closest('.markdown-embed') || !this.headingWrapper(heading)) return false;
			const rect = heading.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom;
		});
	}

	private headingWrapper(heading: HTMLHeadingElement): HTMLElement | null {
		const wrapper = heading.parentElement;
		return wrapper?.parentElement?.matches('.markdown-preview-sizer') ? wrapper : null;
	}


	private createHintEl(label: string, heading: HTMLHeadingElement, doc: Document): HTMLElement {
		const rect = heading.getBoundingClientRect();
		const el = doc.body.createSpan({ cls: `${HINT_CLASS} vim-reading-nav-hint`, text: label.toUpperCase() });
		el.style.left = `${rect.left}px`;
		el.style.top = `${rect.top + rect.height / 2}px`;
		return el;
	}

	private updateHintDisplay(state: DocumentState): void {
		state.hints.forEach((hint) => hint.el.toggleClass(HINT_INACTIVE_CLASS, !hint.label.startsWith(state.typed)));
	}

	private exitHintMode(state: DocumentState): void {
		state.hints.forEach((hint) => hint.el.remove());
		state.hints = [];
		state.typed = '';
		state.active = false;
	}

	private exitAllHintModes(): void {
		for (const state of this.states.values()) this.exitHintMode(state);
	}

	private disposeDocument(doc: Document): void {
		const state = this.states.get(doc);
		if (!state) return;
		this.exitHintMode(state);
		this.states.delete(doc);
	}

	private reapInvalidStates(): void {
		for (const [doc, state] of this.states) {
			if (doc.defaultView?.closed) this.disposeDocument(doc);
			else if (state.active && state.hints.some((hint) => !hint.heading.isConnected || hint.heading.ownerDocument !== doc)) this.exitHintMode(state);
		}
	}

	private stateFor(doc: Document): DocumentState {
		let state = this.states.get(doc);
		if (!state) {
			state = { hints: [], typed: '', active: false };
			this.states.set(doc, state);
		}
		return state;
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
