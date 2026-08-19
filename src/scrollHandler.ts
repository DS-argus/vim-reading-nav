import { Plugin } from 'obsidian';
import { getPreviewViewIn, getScrollElement, isFocusInModal, isVimModeEnabled } from './viewUtils';

const DOUBLE_G_TIMEOUT_MS = 500;
const FALLBACK_LINE_HEIGHT_PX = 24;

export class ReadingModeScrollHandler {
	private lastGPressTime = 0;
	private plugin: Plugin;

	constructor(plugin: Plugin) {
		this.plugin = plugin;
	}

	/** Attach the keydown listener to one document (main window or pop-out). */
	registerTo(doc: Document): void {
		this.plugin.registerDomEvent(doc, 'keydown', (evt: KeyboardEvent) => {
			this.handleKeyDown(evt, doc);
		});
	}

	private handleKeyDown(evt: KeyboardEvent, doc: Document): void {
		// Don't intercept keys when a modal/dialog is open or focus is in an input
		if (isFocusInModal(evt, doc)) return;

		const view = getPreviewViewIn(this.plugin.app, doc);
		if (!view) return;
		if (!isVimModeEnabled(this.plugin.app)) return;

		const scrollEl = getScrollElement(view);
		if (!scrollEl) return;

		const { key, ctrlKey, metaKey, altKey } = evt;

		// Ignore combinations with Meta/Alt to avoid interfering with system shortcuts
		if (metaKey || altKey) return;

		if (!ctrlKey) {
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
					this.scrollHalfPage(scrollEl, 1);
					break;
				case 'u':
					evt.preventDefault();
					this.scrollHalfPage(scrollEl, -1);
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
		} else {
			switch (key) {
				case 'd':
					evt.preventDefault();
					this.scrollHalfPage(scrollEl, 1);
					break;
				case 'u':
					evt.preventDefault();
					this.scrollHalfPage(scrollEl, -1);
					break;
				case 'f':
					evt.preventDefault();
					this.scrollFullPage(scrollEl, 1);
					break;
				case 'b':
					evt.preventDefault();
					this.scrollFullPage(scrollEl, -1);
					break;
			}
		}
	}

	private scrollHalfPage(scrollEl: HTMLElement, direction: 1 | -1): void {
		scrollEl.scrollTop += direction * (scrollEl.clientHeight / 2);
	}

	private scrollFullPage(scrollEl: HTMLElement, direction: 1 | -1): void {
		scrollEl.scrollTop += direction * scrollEl.clientHeight;
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
