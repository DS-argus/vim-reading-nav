import { MarkdownView } from 'obsidian';
import type VimReadingNavPlugin from './main';
import { createHintBadge, HintOverlay } from './hintModes';
import type { HintMode, HintModes } from './hintModes';
import { consumeKey, getPreviewViewIn, getScrollElement, isFocusInModal, isLiveIn } from './viewUtils';

const TRIGGER_KEY = 'F';
const HINT_CLASS = 'vim-reading-nav-heading-hint';

/**
 * Vimium-style heading fold hints for reading mode: `F`, then a label, folds
 * or unfolds that heading's section.
 */
export class HeadingFoldHintHandler implements HintMode {
	private readonly states = new Map<Document, HintOverlay<HTMLHeadingElement>>();

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
		this.hintsFor(doc);
		this.plugin.registerDomEvent(doc, 'keydown', (evt: KeyboardEvent) => this.handleKeyDown(evt, doc));
		// Badges sit at fixed viewport positions, so scrolling or resizing leaves them misplaced.
		this.plugin.registerDomEvent(doc, 'scroll', () => this.hintsFor(doc).close(), { capture: true });
		const win = doc.defaultView;
		if (win) this.plugin.registerDomEvent(win, 'resize', () => this.hintsFor(doc).close());
	}

	isActive(doc: Document): boolean {
		return this.states.get(doc)?.isShowing() ?? false;
	}

	closeHints(doc: Document): void {
		this.states.get(doc)?.close();
	}

	cleanup(): void {
		this.closeAll();
		this.states.clear();
	}

	private handleKeyDown(evt: KeyboardEvent, doc: Document): void {
		if (isFocusInModal(evt, doc)) return;
		const hints = this.hintsFor(doc);
		if (hints.isShowing()) {
			const heading = hints.handleKey(evt);
			if (heading) this.toggleSection(heading, doc);
			return;
		}
		if (evt.ctrlKey || evt.metaKey || evt.altKey || evt.key !== TRIGGER_KEY) return;
		// Another mode's hints own every key, this trigger included.
		if (this.modes.isShowing(doc)) return;
		const view = getPreviewViewIn(this.plugin.app, doc);
		if (!view) return;
		consumeKey(evt);
		if (!evt.repeat) this.showHints(view, doc, hints);
	}

	private showHints(view: MarkdownView, doc: Document, hints: HintOverlay<HTMLHeadingElement>): void {
		const scrollEl = getScrollElement(view);
		if (!scrollEl) return;
		hints.show(this.visibleHeadings(scrollEl), (label, heading) => {
			const rect = heading.getBoundingClientRect();
			return createHintBadge(doc, label, rect.left, rect.top + rect.height / 2, HINT_CLASS);
		});
	}

	/** Clicks Obsidian's own fold arrow, so folding behaves exactly like a mouse click. */
	private toggleSection(heading: HTMLHeadingElement, doc: Document): void {
		if (!isLiveIn(heading, doc)) return;
		heading.querySelector<HTMLElement>(':scope > .heading-collapse-indicator')?.click();
	}

	/** Visible top-level headings; headings inside embeds fold the embedded note, not this one. */
	private visibleHeadings(scrollEl: HTMLElement): HTMLHeadingElement[] {
		const bounds = scrollEl.getBoundingClientRect();
		return Array.from(scrollEl.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6')).filter((heading) => {
			if (heading.closest('.markdown-embed') || !this.isSectionHeading(heading)) return false;
			const rect = heading.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom;
		});
	}

	/** Only a heading in its own top-level section wrapper has a section to fold. */
	private isSectionHeading(heading: HTMLHeadingElement): boolean {
		return heading.parentElement?.parentElement?.matches('.markdown-preview-sizer') ?? false;
	}

	private closeAll(): void {
		for (const hints of this.states.values()) hints.close();
	}

	private disposeDocument(doc: Document): void {
		this.states.get(doc)?.close();
		this.states.delete(doc);
	}

	/** After a layout change, drop closed windows and hints whose headings were re-rendered. */
	private reapInvalidStates(): void {
		for (const [doc, hints] of this.states) {
			if (doc.defaultView?.closed) this.disposeDocument(doc);
			else if (hints.targets().some((heading) => !isLiveIn(heading, doc))) hints.close();
		}
	}

	private hintsFor(doc: Document): HintOverlay<HTMLHeadingElement> {
		let hints = this.states.get(doc);
		if (!hints) {
			hints = new HintOverlay();
			this.states.set(doc, hints);
		}
		return hints;
	}
}
