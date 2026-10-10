/**
 * The board column that the vertical keys scroll in a Bases kanban view.
 *
 * A board scrolls sideways, and each column scrolls its own cards, so `h`/`l`
 * choose a column and `j`/`k` scroll it. Bases renders only the columns in view
 * and keeps each column's elements while it is out of view, so a column is
 * remembered by its group key and placed from the board's layout measurements.
 */

const SELECTED_CLASS = 'vim-reading-nav-board-column';

export interface BoardColumn {
	key: string;
	el: HTMLElement;
	/** Scrolls the column's cards. */
	contentEl: HTMLElement;
}

interface Board {
	columns: BoardColumn[];
	/** Space before the first column and after the last. */
	padStart: number;
	padEnd: number;
	columnWidth: number;
	columnGap: number;
}

/** The visible part of the board, in inline coordinates: from the start edge, whatever the text direction. */
interface Viewport {
	start: number;
	end: number;
	rtl: boolean;
}

export class BoardFocus {
	/** The chosen column of each board, by the board's layout view. */
	private readonly selected = new WeakMap<object, string>();
	private marked: HTMLElement | null = null;

	/**
	 * The column to scroll, outlined on screen. When the chosen column has
	 * scrolled out of view, the first column in view takes its place.
	 */
	current(layoutView: object, scrollEl: HTMLElement): BoardColumn | null {
		const board = readBoard(layoutView);
		if (!board) return null;
		const index = this.resolve(board, layoutView, scrollEl);
		const column = board.columns[index];
		if (column) this.select(layoutView, column);
		return column ?? null;
	}

	/** Chooses the next or previous column and scrolls the board just enough to show it. */
	move(layoutView: object, scrollEl: HTMLElement, step: 1 | -1): void {
		const board = readBoard(layoutView);
		if (!board) return;
		const index = Math.min(board.columns.length - 1, Math.max(0, this.resolve(board, layoutView, scrollEl) + step));
		const column = board.columns[index];
		if (!column) return;
		this.select(layoutView, column);
		reveal(board, index, scrollEl);
	}

	/** Removes the outline, for instance when Bases navigation is turned off. */
	clear(): void {
		this.marked?.removeClass(SELECTED_CLASS);
		this.marked = null;
	}

	private resolve(board: Board, layoutView: object, scrollEl: HTMLElement): number {
		const view = viewport(scrollEl);
		const shown = (index: number): boolean => overlap(board, index, view) >= board.columnWidth / 2;
		const key = this.selected.get(layoutView);
		const chosen = board.columns.findIndex((column) => column.key === key);
		if (chosen >= 0 && shown(chosen)) return chosen;
		const first = board.columns.findIndex((_, index) => shown(index));
		return first >= 0 ? first : Math.max(0, chosen);
	}

	private select(layoutView: object, column: BoardColumn): void {
		this.selected.set(layoutView, column.key);
		if (this.marked === column.el) return;
		this.clear();
		column.el.addClass(SELECTED_CLASS);
		this.marked = column.el;
	}
}

/** Reads the board's columns and measurements, or null if Bases no longer has this shape. */
function readBoard(layoutView: object): Board | null {
	const { columns, measurements } = layoutView as { columns?: unknown; measurements?: unknown };
	if (!Array.isArray(columns) || columns.length === 0) return null;
	const read: BoardColumn[] = [];
	for (const column of columns as unknown[]) {
		const { group, containerEl, contentEl } = (column ?? {}) as { group?: { key?: unknown }; containerEl?: unknown; contentEl?: unknown };
		if (!group || !isElement(containerEl) || !isElement(contentEl)) return null;
		read.push({ key: String(group.key), el: containerEl, contentEl });
	}
	const { pad, columnWidth, columnGap } = (measurements ?? {}) as { pad?: { start?: unknown; end?: unknown }; columnWidth?: unknown; columnGap?: unknown };
	const padStart = pad?.start;
	const padEnd = pad?.end;
	if (!isSize(padStart) || !isSize(padEnd) || !isSize(columnWidth) || columnWidth === 0 || !isSize(columnGap)) return null;
	return { columns: read, padStart, padEnd, columnWidth, columnGap };
}

function isElement(value: unknown): value is HTMLElement {
	// Pop-out windows have their own HTMLElement, so use Obsidian's cross-window check.
	return typeof value === 'object' && value !== null &&
		typeof (value as { instanceOf?: unknown }).instanceOf === 'function' &&
		(value as Node).instanceOf(HTMLElement);
}

function isSize(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function viewport(scrollEl: HTMLElement): Viewport {
	// Chromium counts scrollLeft down from 0 in right-to-left text.
	const rtl = scrollEl.ownerDocument.defaultView?.getComputedStyle(scrollEl).direction === 'rtl';
	const start = rtl ? -scrollEl.scrollLeft : scrollEl.scrollLeft;
	return { start, end: start + scrollEl.clientWidth, rtl };
}

function columnStart(board: Board, index: number): number {
	return board.padStart + index * (board.columnWidth + board.columnGap);
}

function overlap(board: Board, index: number, view: Viewport): number {
	const start = columnStart(board, index);
	return Math.min(start + board.columnWidth, view.end) - Math.max(start, view.start);
}

/** Scrolls the board so the column and the space beside it are in view. */
function reveal(board: Board, index: number, scrollEl: HTMLElement): void {
	const view = viewport(scrollEl);
	const last = index === board.columns.length - 1;
	const start = columnStart(board, index) - (index === 0 ? board.padStart : board.columnGap);
	const end = columnStart(board, index) + board.columnWidth + (last ? board.padEnd : board.columnGap);
	let scroll = view.start;
	if (end > view.end) scroll = end - scrollEl.clientWidth;
	// A column wider than the board shows its start.
	if (start < scroll) scroll = start;
	if (scroll !== view.start) scrollEl.scrollLeft = view.rtl ? -scroll : scroll;
}
