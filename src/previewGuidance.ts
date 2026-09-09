export interface PreviewGuidance {
	note?: string;
	items: {
		key: string;
		description: string;
		emphasized?: boolean;
	}[];
}

export type PreviewTargetKind = 'internal' | 'standardFootnote' | 'external' | 'inlineFootnote';
export type PendingSplitDirection = 'right' | 'below';

/** Only opening actions are advertised; scrolling and Escape still work. */
export function previewGuidance(kind: PreviewTargetKind, canSplit = false): PreviewGuidance {
	if (kind === 'inlineFootnote') return { items: [] };
	if (kind === 'standardFootnote') return { items: [{ key: '↵', description: 'Jump' }] };
	const items: PreviewGuidance['items'] = [{ key: '↵', description: 'Open' }];
	if (kind === 'internal' && canSplit) {
		items.push(
			{ key: 'v/V', description: 'Right' },
			{ key: 'h/H', description: 'Below' },
		);
	}
	return kind === 'internal' && canSplit
		? { items, note: '(Uppercase: always new split)' }
		: { items };
}

export function pendingSplitGuidance(direction: PendingSplitDirection, newPane: boolean): PreviewGuidance {
	const key = direction === 'right' ? 'v' : 'h';
	return { items: [{
		key: `${newPane ? key.toUpperCase() : key} → ↵`,
		description: `${newPane ? 'New split' : 'Open'} ${direction}`,
		emphasized: true,
	}] };
}
