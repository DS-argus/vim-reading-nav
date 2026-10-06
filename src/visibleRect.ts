/** Viewport rectangle of the part of an element a reader can actually see. */
export interface VisibleRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/**
 * Clip `rect` (a box belonging to `el`) to the scroll viewport and to every
 * overflow-clipping ancestor up to `scrollEl`, such as embed bodies and
 * callouts. Returns null when nothing of it is visible.
 */
export function visibleRect(el: HTMLElement, rect: DOMRect, scrollEl: HTMLElement, bounds: DOMRect): VisibleRect | null {
	if (rect.width <= 0 || rect.height <= 0) return null;
	let visible = intersect(rect, bounds);
	const win = el.ownerDocument.defaultView;
	for (let parent = el.parentElement; visible && win && parent && parent !== scrollEl; parent = parent.parentElement) {
		const style = win.getComputedStyle(parent);
		if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
			visible = intersect(visible, parent.getBoundingClientRect());
		}
	}
	return visible;
}

function intersect(first: VisibleRect, second: VisibleRect): VisibleRect | null {
	const left = Math.max(first.left, second.left);
	const right = Math.min(first.right, second.right);
	const top = Math.max(first.top, second.top);
	const bottom = Math.min(first.bottom, second.bottom);
	return right > left && bottom > top ? { left, top, right, bottom } : null;
}
