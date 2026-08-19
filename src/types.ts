import { Editor } from 'obsidian';

/** Screen coordinates returned by CodeMirror's coordsAtPos */
export interface CMCoords {
	top: number;
	bottom: number;
	left: number;
	right: number;
}

/** Subset of the CodeMirror 6 EditorView API used by this plugin */
export interface CMEditorView {
	coordsAtPos(pos: number, side?: number): CMCoords | null;
	posAtCoords(coords: { x: number; y: number }, precise: false): number;
	posAtCoords(coords: { x: number; y: number }, precise?: boolean): number | null;
	scrollDOM: HTMLElement;
}

/** Obsidian's Editor extended with the underlying CodeMirror EditorView */
export interface EditorWithCM extends Editor {
	cm: CMEditorView;
}
