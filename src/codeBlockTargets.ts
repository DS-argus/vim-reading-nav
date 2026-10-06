import { createHintBadge } from './hintModes';
import { visibleRect } from './visibleRect';
import type { VisibleRect } from './visibleRect';

/** A rendered code block and the native copy button Obsidian attached to it. */
export interface CodeBlockTarget {
	pre: HTMLElement;
	button: HTMLButtonElement;
	visible: VisibleRect;
}

// Roughly the vertical center of Obsidian's native copy button.
const HINT_BUTTON_CENTER_PX = 18;
const HINT_INSET_PX = 6;

/**
 * Collect visible code blocks that carry Obsidian's native copy button, in
 * document order. Blocks inside embeds and callouts count. Mermaid, math and
 * other replaced blocks have no such button and are skipped. Clipping by
 * overflow ancestors (embed bodies, callouts) is applied so a block scrolled
 * out of its embed never receives a hint.
 */
export function collectVisibleCodeBlocks(scrollEl: HTMLElement): CodeBlockTarget[] {
	const bounds = scrollEl.getBoundingClientRect();
	const targets: CodeBlockTarget[] = [];
	scrollEl.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
		const button = copyButton(pre);
		if (!button) return;
		const visible = visibleRect(pre, pre.getBoundingClientRect(), scrollEl, bounds);
		if (visible) targets.push({ pre, button, visible });
	});
	return targets;
}

/** Place a hint at the top-right of the visible part, where the native button sits. */
export function createCodeBlockHintElement(label: string, target: CodeBlockTarget, doc: Document): HTMLElement {
	const { visible } = target;
	// A block shorter than the button gets its hint centered instead.
	const top = visible.top + Math.min(HINT_BUTTON_CENTER_PX, (visible.bottom - visible.top) / 2);
	return createHintBadge(doc, label, visible.right - HINT_INSET_PX, top, 'vim-reading-nav-code-hint');
}

function copyButton(pre: HTMLElement): HTMLButtonElement | null {
	return Array.from(pre.querySelectorAll<HTMLButtonElement>('button.copy-code-button'))
		.find((button) => button.closest('pre') === pre) ?? null;
}
