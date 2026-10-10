import type { Plugin } from 'obsidian';
import { bindingMatchesEvent } from './settings';
import type { VimReadingNavSettings } from './settings';
import { getPreviewViewIn, getScrollElement, isFocusInModal } from './viewUtils';

export const DOUBLE_G_TIMEOUT_MS = 500;
const FALLBACK_LINE_HEIGHT_PX = 24;

export type ScrollDirection = 1 | -1;

export interface PageScroll {
	amount: ScrollDirection;
	distance: 'half' | 'full';
}

/** The page scroll a configured binding asks for, if `evt` matches one. Bases scrolling shares the bindings. */
export function configuredPageScroll(settings: VimReadingNavSettings, evt: KeyboardEvent): PageScroll | null {
	if (bindingMatchesEvent(settings.halfPageDown, evt)) return { amount: 1, distance: 'half' };
	if (bindingMatchesEvent(settings.halfPageUp, evt)) return { amount: -1, distance: 'half' };
	if (bindingMatchesEvent(settings.fullPageDown, evt)) return { amount: 1, distance: 'full' };
	if (bindingMatchesEvent(settings.fullPageUp, evt)) return { amount: -1, distance: 'full' };
	return null;
}

export function scrollHalfPage(scrollEl: HTMLElement, direction: ScrollDirection): void {
	scrollEl.scrollTop += direction * (scrollEl.clientHeight / 2);
}

/** Scrolls a page, keeping two lines of the old page in view. */
export function scrollFullPage(scrollEl: HTMLElement, direction: ScrollDirection, lineHeight: number): void {
	const distance = Math.max(lineHeight, scrollEl.clientHeight - (2 * lineHeight));
	scrollEl.scrollTop += direction * distance;
}

export class ReadingModeScrollHandler {
	private lastGPressTime = 0;

	constructor(
		private readonly plugin: Plugin,
		private readonly settings: VimReadingNavSettings,
	) {}

	/** Attach keydown listeners to one document (main window or pop-out). */
	registerTo(doc: Document): void {
		this.plugin.registerDomEvent(doc, 'keydown', (evt: KeyboardEvent) => {
			this.handleConfiguredKeyDown(evt, doc);
		}, true);
		this.plugin.registerDomEvent(doc, 'keydown', (evt: KeyboardEvent) => {
			this.handleBareKeyDown(evt, doc);
		});
	}

	private handleConfiguredKeyDown(evt: KeyboardEvent, doc: Document): void {
		const scrollEl = this.getReadingScrollElement(evt, doc);
		if (!scrollEl) return;

		const direction = configuredPageScroll(this.settings, evt);
		if (!direction) return;

		evt.preventDefault();
		evt.stopImmediatePropagation();
		if (direction.distance === 'half') {
			scrollHalfPage(scrollEl, direction.amount);
		} else {
			scrollFullPage(scrollEl, direction.amount, this.getCssLineHeight(scrollEl));
		}
	}

	private handleBareKeyDown(evt: KeyboardEvent, doc: Document): void {
		const scrollEl = this.getReadingScrollElement(evt, doc);
		if (!scrollEl) return;

		const { key, ctrlKey, metaKey, altKey } = evt;
		if (ctrlKey || metaKey || altKey) return;

		switch (key) {
			case 'j':
				evt.preventDefault();
				scrollEl.scrollTop += this.getLineHeight(scrollEl);
				break;
			case 'k':
				evt.preventDefault();
				scrollEl.scrollTop -= this.getLineHeight(scrollEl);
				break;
			case 'd':
				evt.preventDefault();
				scrollHalfPage(scrollEl, 1);
				break;
			case 'u':
				evt.preventDefault();
				scrollHalfPage(scrollEl, -1);
				break;
			case 'g': {
				evt.preventDefault();
				const now = Date.now();
				if (now - this.lastGPressTime <= DOUBLE_G_TIMEOUT_MS) {
					scrollEl.scrollTop = 0;
					this.lastGPressTime = 0;
				} else {
					this.lastGPressTime = now;
				}
				break;
			}
			case 'G':
				evt.preventDefault();
				scrollEl.scrollTop = scrollEl.scrollHeight;
				break;
		}
	}

	private getReadingScrollElement(evt: KeyboardEvent, doc: Document): HTMLElement | null {
		if (isFocusInModal(evt, doc)) return null;

		const view = getPreviewViewIn(this.plugin.app, doc);
		return view ? getScrollElement(view) : null;
	}

	private getCssLineHeight(scrollEl: HTMLElement): number {
		const win = scrollEl.ownerDocument.defaultView;
		if (!win) return FALLBACK_LINE_HEIGHT_PX;

		const lineHeight = Number.parseFloat(win.getComputedStyle(scrollEl).lineHeight);
		return lineHeight > 0 ? lineHeight : FALLBACK_LINE_HEIGHT_PX;
	}

	private getLineHeight(scrollEl: HTMLElement): number {
		const line = scrollEl.querySelector<HTMLElement>('p, li, h1, h2, h3, h4, h5, h6');
		if (line) {
			const height = line.getBoundingClientRect().height;
			if (height > 0) return height;
		}
		return FALLBACK_LINE_HEIGHT_PX;
	}
}
