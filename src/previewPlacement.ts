/** Viewport-relative edges of the focused target, as from getBoundingClientRect(). */
export interface PlacementTarget {
	left: number;
	top: number;
	bottom: number;
}

export interface PreviewPlacement {
	/** Below the target the preview grows downward; above it, upward. Either way it never covers the target. */
	side: 'below' | 'above';
	left: number;
	/** Distance from the viewport edge on the preview's side: the top edge when below, the bottom edge when above. */
	inset: number;
	/** Height available on that side; the preview never grows past it, even when late content loads. */
	room: number;
}

const MARGIN = 12;
// Clears the focus outline (2px wide, 2px offset).
const GAP = 8;

/**
 * Places a preview of the given natural size next to the target without covering it:
 * below when it fits, otherwise above when it fits, otherwise on the roomier side.
 */
export function placePreview(
	target: PlacementTarget,
	width: number,
	height: number,
	viewportWidth: number,
	viewportHeight: number,
): PreviewPlacement {
	// A target scrolled out of view pins the preview to the nearest viewport edge.
	const belowInset = Math.max(MARGIN, target.bottom + GAP);
	const aboveInset = Math.max(MARGIN, viewportHeight - target.top + GAP);
	const below = viewportHeight - MARGIN - belowInset;
	const above = viewportHeight - MARGIN - aboveInset;
	const side = height <= below || (height > above && below >= above) ? 'below' : 'above';
	return {
		side,
		left: Math.max(MARGIN, Math.min(target.left, viewportWidth - width - MARGIN)),
		inset: side === 'below' ? belowInset : aboveInset,
		room: Math.max(0, side === 'below' ? below : above),
	};
}
