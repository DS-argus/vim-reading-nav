import { View } from 'obsidian';
import type { App } from 'obsidian';
import type { VimReadingNavSettings } from './settings';

/**
 * Bases has no public API for its own views, so the keys reach them through
 * Obsidian internals. Every lookup checks the shape it relies on and yields
 * nothing when an Obsidian update changes it.
 */

/** The type a Bases file view registers. */
const BASES_VIEW_TYPE = 'bases';

/** Obsidian's own layouts. Layouts that plugins add, such as Maps, render their own way. */
const BUILT_IN_LAYOUTS = ['table', 'cards', 'list', 'kanban'] as const;
export type BasesLayout = typeof BUILT_IN_LAYOUTS[number];

/** The internal controller of a Bases file view: its views, and the active one's layout. */
export interface BasesController {
	viewName: string;
	view: unknown;
	getQueryViewNames(): string[];
	selectView(name: string): void;
}

/** The results of a view with a built-in layout. */
export interface BasesResults {
	layout: BasesLayout;
	/** The layout's internal view. A board keeps its columns here. */
	layoutView: object;
	/** Scrolls the results: both ways in a table, cards, or list; sideways on a board. */
	scrollEl: HTMLElement;
}

export interface ActiveBases {
	controller: BasesController;
	/** Null when the active view uses a layout that another plugin adds. */
	results: BasesResults | null;
}

/**
 * The active Bases file view in `doc`, if Bases navigation is enabled. Like
 * `getPreviewViewIn`, the document check keeps pop-out windows apart.
 */
export function getActiveBases(app: App, settings: VimReadingNavSettings, doc: Document): ActiveBases | null {
	if (!settings.enableBasesNavigation) return null;
	const view = app.workspace.getActiveViewOfType(View);
	if (!view || view.getViewType() !== BASES_VIEW_TYPE || view.containerEl.ownerDocument !== doc) return null;
	const controller = readController(view);
	return controller ? { controller, results: readResults(view, controller) } : null;
}

/** Shows the next or previous view of the file, wrapping around, like Obsidian's Mod+Shift+PageDown/PageUp. */
export function switchBasesView(controller: BasesController, step: 1 | -1): void {
	const names = controller.getQueryViewNames();
	if (names.length < 2) return;
	const index = names.indexOf(controller.viewName);
	const next = names[(index + step + names.length) % names.length];
	if (next === undefined) return;
	controller.selectView(next);
	// Like Obsidian's shortcut, so the new layout's own keys, such as the table's arrows, work at once.
	const layoutView = controller.view as { focus?: unknown } | null;
	if (typeof layoutView?.focus === 'function') (layoutView as { focus(): void }).focus();
}

function readController(view: View): BasesController | null {
	const controller = (view as unknown as { controller?: Partial<BasesController> }).controller;
	if (
		!controller ||
		typeof controller.viewName !== 'string' ||
		typeof controller.getQueryViewNames !== 'function' ||
		typeof controller.selectView !== 'function'
	) return null;
	return controller as BasesController;
}

function readResults(view: View, controller: BasesController): BasesResults | null {
	const layoutView = controller.view;
	if (typeof layoutView !== 'object' || layoutView === null) return null;
	const layout = (layoutView as { type?: unknown }).type;
	if (!isBuiltInLayout(layout)) return null;
	const scrollEl = view.containerEl.querySelector<HTMLElement>('.bases-view');
	return scrollEl ? { layout, layoutView, scrollEl } : null;
}

function isBuiltInLayout(layout: unknown): layout is BasesLayout {
	return (BUILT_IN_LAYOUTS as readonly unknown[]).includes(layout);
}
