import { App, MarkdownView } from 'obsidian';

/**
 * Shared guards and lookups used by both the scroll handler and the link
 * hint handler. All functions are document-aware so they work in pop-out
 * windows as well as the main window.
 */

/**
 * Return the active MarkdownView if it is in reading mode (preview) AND
 * belongs to the given document. The document check matters with pop-out
 * windows: a keydown in one window must not drive a view in another.
 */
export function getPreviewViewIn(app: App, doc: Document): MarkdownView | null {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (!view || view.getMode() !== 'preview') return null;
	if (view.containerEl.ownerDocument !== doc) return null;
	return view;
}

export function getScrollElement(view: MarkdownView): HTMLElement | null {
	return view.containerEl.querySelector<HTMLElement>('.markdown-preview-view');
}

/**
 * True when the key event should NOT be intercepted: focus is in an
 * input-like element, a modal/prompt/suggestion is open, or the target is
 * not a plain HTML element.
 *
 * The instanceof check is performed against the document's own window so it
 * stays correct across realms (each pop-out window has its own HTMLElement
 * constructor; `target instanceof HTMLElement` with the main-window
 * constructor would be false for pop-out elements).
 */
export function isFocusInModal(evt: KeyboardEvent, doc: Document): boolean {
	const win = doc.defaultView;
	const target = evt.target;
	// Unknown or non-HTML targets (Document, SVG, cross-realm oddities):
	// yield rather than intercept.
	if (!win || !(target instanceof win.HTMLElement)) return true;
	// Yield to any focused input-like element
	if (
		target.tagName === 'INPUT' ||
		target.tagName === 'TEXTAREA' ||
		target.tagName === 'SELECT' ||
		target.isContentEditable
	) return true;
	// Yield to Obsidian modals, prompts, and suggestion dropdowns
	if (target.closest('.modal-container, .prompt, .suggestion-container')) return true;
	// Yield if any modal overlay is currently visible in this window
	if (doc.querySelector('.modal-container')) return true;
	return false;
}
