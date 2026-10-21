import type { CMCoords, CMEditorView } from './types';

const EDGE_SLACK_PX = 1;
const PLACEMENT_PERCENTAGE = 45;

export interface EditorViewport { left: number; right: number; top: number; bottom: number; }
export type Placement = 'wait' | 'none' | number;
type Candidate = { kind: 'wait' } | { kind: 'ready'; pos: number; box: CMCoords; ordinary: boolean };

function rowStart(cm: CMEditorView, vp: EditorViewport, y: number): number | null {
	return cm.posAtCoords({ x: vp.left + 1, y });
}

export function measurableViewport(cm: CMEditorView): EditorViewport | null {
	const rect = cm.scrollDOM.getBoundingClientRect();
	if (cm.scrollDOM.clientHeight <= 0 || rect.right <= rect.left || rect.bottom <= rect.top) return null;
	const vp = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
	return rowStart(cm, vp, vp.top + 1) === null ? null : vp;
}

export function isFullyVisible(box: CMCoords, vp: EditorViewport): boolean {
	return box.bottom > box.top && box.top >= vp.top - EDGE_SLACK_PX
		&& box.bottom <= vp.bottom + EDGE_SLACK_PX;
}

function inspect(cm: CMEditorView, vp: EditorViewport, y: number): Candidate {
	const pos = rowStart(cm, vp, y);
	if (pos === null) return { kind: 'wait' };
	const box = cm.coordsAtPos(pos, 1);
	if (!box) return { kind: 'wait' };
	const probe = rowStart(cm, vp, box.top + Math.min(1, (box.bottom - box.top) / 2));
	if (probe === null) return { kind: 'wait' };
	return { kind: 'ready', pos, box, ordinary: probe === pos };
}

/** Choose a fully visible text row at or below 45% of the viewport without scrolling. */
export function placementTarget(cm: CMEditorView): Placement {
	const vp = measurableViewport(cm);
	if (!vp) return 'wait';

	const targetY = vp.top + (vp.bottom - vp.top) * PLACEMENT_PERCENTAGE / 100;
	const startY = Math.min(vp.bottom - 1, Math.max(vp.top + 1, targetY));
	let unresolved = false;
	for (let y = startY; y < vp.bottom; y++) {
		const candidate = inspect(cm, vp, y);
		if (candidate.kind === 'wait') {
			unresolved = true;
			continue;
		}
		if (candidate.ordinary && isFullyVisible(candidate.box, vp)
			&& candidate.box.bottom > startY) return candidate.pos;
	}
	return unresolved ? 'wait' : 'none';
}
