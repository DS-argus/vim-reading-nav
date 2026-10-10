import type VimReadingNavPlugin from './main';
import { BoardFocus } from './basesBoard';
import { getActiveBases, switchBasesView } from './basesView';
import type { ActiveBases, BasesResults } from './basesView';
import { configuredPageScroll, DOUBLE_G_TIMEOUT_MS, scrollFullPage, scrollHalfPage } from './scrollHandler';
import { executeOpenSearch } from './searchHandler';
import { consumeKey, isFocusInModal } from './viewUtils';

// The default Bases table row height; also a comfortable step for cards, lists, and board columns.
const LINE_PX = 30;

/**
 * Keys for Bases files, when enabled in settings:
 * - Any view: `Shift+J`/`Shift+K` switch views, `/` opens the search.
 * - Built-in layouts: `j`/`k`, `d`/`u`, `gg`/`G` and the page bindings scroll; `h`/`l`
 *   scroll sideways, or on a board choose the column the other keys scroll.
 */
export class BasesKeyHandler {
	private readonly board = new BoardFocus();
	private lastGPressTime = 0;

	constructor(private readonly plugin: VimReadingNavPlugin) {}

	register(): void {
		this.plugin.register(() => this.board.clear());
	}

	registerTo(doc: Document): void {
		// Capture phase: a focused table answers keys on its own element before the document does.
		this.plugin.registerDomEvent(doc, 'keydown', (evt: KeyboardEvent) => this.handleKeyDown(evt, doc), true);
	}

	settingsChanged(): void {
		if (!this.plugin.settings.enableBasesNavigation) this.board.clear();
	}

	private handleKeyDown(evt: KeyboardEvent, doc: Document): void {
		if (isFocusInModal(evt, doc)) return;
		const bases = getActiveBases(this.plugin.app, this.plugin.settings, doc);
		if (!bases || this.handleFileKey(evt, bases) || !bases.results) return;
		this.handleResultsKey(evt, bases.results);
	}

	/** Keys for the file as a whole, whatever its layout. */
	private handleFileKey(evt: KeyboardEvent, bases: ActiveBases): boolean {
		if (evt.ctrlKey || evt.metaKey || evt.altKey) return false;
		if (evt.key === 'J' || evt.key === 'K') {
			consumeKey(evt);
			// Holding the keys switches once, rather than racing through every view.
			if (!evt.repeat) switchBasesView(bases.controller, evt.key === 'J' ? 1 : -1);
			return true;
		}
		if (evt.key === '/' && executeOpenSearch(this.plugin.app)) {
			consumeKey(evt);
			return true;
		}
		return false;
	}

	private handleResultsKey(evt: KeyboardEvent, results: BasesResults): void {
		const page = configuredPageScroll(this.plugin.settings, evt);
		if (page) {
			const el = this.verticalScrollElement(results);
			if (!el) return;
			consumeKey(evt);
			if (page.distance === 'half') scrollHalfPage(el, page.amount);
			else scrollFullPage(el, page.amount, LINE_PX);
			return;
		}
		if (evt.ctrlKey || evt.metaKey || evt.altKey) return;
		const { key } = evt;
		if (key === 'h' || key === 'l') {
			consumeKey(evt);
			const step = key === 'l' ? 1 : -1;
			if (results.layout === 'kanban') this.board.move(results.layoutView, results.scrollEl, step);
			else results.scrollEl.scrollLeft += step * LINE_PX;
			return;
		}
		if (!['j', 'k', 'd', 'u', 'g', 'G'].includes(key)) return;
		const el = this.verticalScrollElement(results);
		if (!el) return;
		consumeKey(evt);
		this.scrollVertically(el, key);
	}

	/** A board's cards scroll inside the chosen column; other layouts scroll as a whole. */
	private verticalScrollElement(results: BasesResults): HTMLElement | null {
		if (results.layout !== 'kanban') return results.scrollEl;
		return this.board.current(results.layoutView, results.scrollEl)?.contentEl ?? null;
	}

	private scrollVertically(el: HTMLElement, key: string): void {
		if (key === 'j') el.scrollTop += LINE_PX;
		else if (key === 'k') el.scrollTop -= LINE_PX;
		else if (key === 'd') scrollHalfPage(el, 1);
		else if (key === 'u') scrollHalfPage(el, -1);
		else if (key === 'G') el.scrollTop = el.scrollHeight;
		else if (Date.now() - this.lastGPressTime <= DOUBLE_G_TIMEOUT_MS) {
			el.scrollTop = 0;
			this.lastGPressTime = 0;
		} else {
			this.lastGPressTime = Date.now();
		}
	}
}
