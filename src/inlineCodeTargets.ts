import { createHintBadge } from './hintModes';
import { visibleRect } from './visibleRect';
import type { VisibleRect } from './visibleRect';

/** A rendered inline code span and the text a reader expects to copy. */
export interface InlineCodeTarget {
	code: HTMLElement;
	text: string;
	visible: VisibleRect;
}

// Decorations Code Styler prepends to inline code, e.g. `{py title:"x"} code`.
const DECORATION_SELECTOR = '.code-styler-inline-opener';

/**
 * Collect visible inline code spans in document order. Code inside `pre`
 * belongs to a code block, and empty spans have nothing to copy. A span that
 * wraps across lines is anchored at its first visible line box.
 */
export function collectVisibleInlineCode(scrollEl: HTMLElement): InlineCodeTarget[] {
	const bounds = scrollEl.getBoundingClientRect();
	const targets: InlineCodeTarget[] = [];
	scrollEl.querySelectorAll<HTMLElement>('code').forEach((code) => {
		if (code.closest('pre')) return;
		const text = inlineCodeText(code);
		if (!text) return;
		for (const rect of lineBoxes(code)) {
			const visible = visibleRect(code, rect, scrollEl, bounds);
			if (visible) {
				targets.push({ code, text, visible });
				return;
			}
		}
	});
	return targets;
}

/**
 * The literal code, without Code Styler titles or icons, its zero-width
 * space, or the line break its highlighter appends to a highlighted span.
 */
export function inlineCodeText(code: HTMLElement): string {
	let source: HTMLElement = code;
	if (code.querySelector(DECORATION_SELECTOR)) {
		source = code.cloneNode(true) as HTMLElement;
		source.querySelectorAll(DECORATION_SELECTOR).forEach((el) => el.remove());
	}
	return (source.textContent ?? '').replace(/\u200b/g, '').replace(/\r?\n$/, '');
}

/**
 * Anchor a hint on the top-left corner of the span's first visible line box.
 * The stylesheet centers a small badge on that corner, so even one-character
 * code stays readable.
 */
export function createInlineCodeHintElement(label: string, target: InlineCodeTarget, doc: Document): HTMLElement {
	return createHintBadge(doc, label, target.visible.left, target.visible.top, 'vim-reading-nav-inline-code-hint');
}

function lineBoxes(code: HTMLElement): DOMRect[] {
	const rects = Array.from(code.getClientRects());
	return rects.length > 0 ? rects : [code.getBoundingClientRect()];
}
