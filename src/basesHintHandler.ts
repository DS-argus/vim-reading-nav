import type VimReadingNavPlugin from './main';
import { getActiveBases } from './basesView';
import { createHintBadge, HintOverlay } from './hintModes';
import type { HintMode, HintModes } from './hintModes';
import { consumeKey, isFocusInModal, isLiveIn } from './viewUtils';
import { visibleRect } from './visibleRect';
import type { VisibleRect } from './visibleRect';

/** `f` clicks links and cards; `F` folds groups, like `F` folds headings in a note. */
export type BasesHintKind = 'click' | 'fold';

const TRIGGERS: Record<string, BasesHintKind> = { f: 'click', F: 'fold' };
/** Rendered links, links in editable property cells, and tags. */
const LINK_SELECTOR = '.internal-link, .external-link, a.tag';
/** A card opens its note when clicked anywhere outside a link. */
const ITEM_SELECTOR = '.bases-cards-item, .bases-kanban-card';
/** Group headings in a table, cards, or list. Board column headings do not fold. */
const GROUP_SELECTOR = '.bases-group-heading.mod-collapsible';
// Keeps a card's badge inside its top-left corner.
const ITEM_HINT_INSET_PX = 12;
const FOLD_HINT_CLASS = 'vim-reading-nav-heading-hint';

export interface BasesHintTarget {
	el: HTMLElement;
	visible: VisibleRect;
	/** A card, whose badge sits inside its corner rather than on its left edge. */
	item: boolean;
}

/**
 * Visible targets of one hint kind, in reading order. Table rows are
 * positioned absolutely and reused while scrolling, so DOM order is not reading order.
 */
export function collectBasesHintTargets(scrollEl: HTMLElement, kind: BasesHintKind): BasesHintTarget[] {
	const bounds = resultBounds(scrollEl);
	const selector = kind === 'click' ? `${ITEM_SELECTOR}, ${LINK_SELECTOR}` : GROUP_SELECTOR;
	const targets: BasesHintTarget[] = [];
	scrollEl.querySelectorAll<HTMLElement>(selector).forEach((el) => {
		if (isInert(el)) return;
		const visible = visibleRect(el, el.getBoundingClientRect(), scrollEl, bounds);
		if (visible) targets.push({ el, visible, item: el.matches(ITEM_SELECTOR) });
	});
	return targets.sort((a, b) => Math.round(a.visible.top) - Math.round(b.visible.top) || a.visible.left - b.visible.left);
}

/** The scroll viewport, minus the table header pinned over the first rows. */
function resultBounds(scrollEl: HTMLElement): VisibleRect {
	const { left, top, right, bottom } = scrollEl.getBoundingClientRect();
	const header = scrollEl.querySelector<HTMLElement>(':scope > .bases-thead');
	return { left, right, bottom, top: header ? Math.max(top, header.getBoundingClientRect().bottom) : top };
}

/** Bases measures layout with invisible sample cards and headings that ignore clicks. */
function isInert(el: HTMLElement): boolean {
	const win = el.ownerDocument.defaultView;
	return win !== null && win.getComputedStyle(el).pointerEvents === 'none';
}

/**
 * Vimium-style hints for Bases files. Choosing a hint clicks the target
 * exactly like the mouse: a link opens, a card opens its note, a group folds.
 */
export class BasesHintHandler implements HintMode {
	private readonly states = new Map<Document, HintOverlay<BasesHintTarget>>();

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
		// Capture phase: a focused Bases table answers keys before the document
		// does, and Backspace there clears the selected cells.
		this.plugin.registerDomEvent(doc, 'keydown', (evt: KeyboardEvent) => this.handleKeyDown(evt, doc), true);
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

	settingsChanged(): void {
		if (!this.plugin.settings.enableBasesNavigation) this.closeAll();
	}

	cleanup(): void {
		this.closeAll();
		this.states.clear();
	}

	private handleKeyDown(evt: KeyboardEvent, doc: Document): void {
		if (isFocusInModal(evt, doc)) return;
		const hints = this.hintsFor(doc);
		if (hints.isShowing()) {
			const target = hints.handleKey(evt);
			if (target && isLiveIn(target.el, doc)) target.el.click();
			return;
		}
		const kind = TRIGGERS[evt.key];
		if (!kind || evt.ctrlKey || evt.metaKey || evt.altKey) return;
		// Another mode's hints own every key, this trigger included.
		if (this.modes.isShowing(doc)) return;
		const results = getActiveBases(this.plugin.app, this.plugin.settings, doc)?.results;
		if (!results) return;
		consumeKey(evt);
		if (evt.repeat) return;
		hints.show(collectBasesHintTargets(results.scrollEl, kind), (label, target) => createBadge(doc, label, target, kind));
	}

	private closeAll(): void {
		for (const hints of this.states.values()) hints.close();
	}

	private disposeDocument(doc: Document): void {
		this.states.get(doc)?.close();
		this.states.delete(doc);
	}

	/** After a layout change, drop closed windows and hints whose targets were re-rendered. */
	private reapInvalidStates(): void {
		for (const [doc, hints] of this.states) {
			if (doc.defaultView?.closed) this.disposeDocument(doc);
			else if (hints.targets().some((target) => !isLiveIn(target.el, doc))) hints.close();
		}
	}

	private hintsFor(doc: Document): HintOverlay<BasesHintTarget> {
		let hints = this.states.get(doc);
		if (!hints) {
			hints = new HintOverlay();
			this.states.set(doc, hints);
		}
		return hints;
	}
}

/** A link's or group's badge sits on its left edge, a card's inside its top-left corner. */
function createBadge(doc: Document, label: string, target: BasesHintTarget, kind: BasesHintKind): HTMLElement {
	const { visible } = target;
	if (target.item) return createHintBadge(doc, label, visible.left + ITEM_HINT_INSET_PX, visible.top + ITEM_HINT_INSET_PX);
	const modeClass = kind === 'fold' ? FOLD_HINT_CLASS : undefined;
	return createHintBadge(doc, label, visible.left, (visible.top + visible.bottom) / 2, modeClass);
}
