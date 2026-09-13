import { Component } from 'obsidian';
import type { VimReadingNavSettings } from './settings';

const DIM_CLASS = 'vim-reading-nav-focus-dim';

/** A short-lived component owning one Reading pane's DOM effects. */
export class ReadingFocusPane extends Component {
	readonly doc: Document;
	private blocks: HTMLElement[] = [];
	private dirty = true;
	private active = false;
	private frame: number | null = null;

	constructor(
		readonly root: HTMLElement,
		private readonly viewEl: HTMLElement,
		private readonly refreshView: () => void,
		private readonly settings: VimReadingNavSettings,
	) {
		super();
		this.doc = root.ownerDocument;
	}

	onload(): void {
		const win = this.doc.defaultView;
		if (!win) return;
		this.active = true;
		const opacity = this.root.style.getPropertyValue('--vim-reading-nav-focus-opacity');
		const priority = this.root.style.getPropertyPriority('--vim-reading-nav-focus-opacity');
		this.register(() => {
			if (opacity) this.root.style.setProperty('--vim-reading-nav-focus-opacity', opacity, priority);
			else this.root.style.removeProperty('--vim-reading-nav-focus-opacity');
		});
		this.settingsChanged();
		const resize = new win.ResizeObserver(() => this.schedule());
		const mutations = new win.MutationObserver(() => {
			this.dirty = true;
			this.refreshView();
			this.schedule();
		});
		mutations.observe(this.viewEl, {
			childList: true, subtree: true, characterData: true,
			attributes: true, attributeFilter: ['style', 'hidden', 'src'],
		});
		this.register(() => {
			mutations.disconnect();
			resize.disconnect();
			if (this.frame !== null) win.cancelAnimationFrame(this.frame);
			this.active = false;
			this.frame = null;
			this.blocks.forEach((block) => block.classList.remove(DIM_CLASS));
			this.blocks = [];
		});
		this.registerDomEvent(this.root, 'scroll', () => this.schedule(), { passive: true });
		this.registerDomEvent(this.root, 'load', () => this.schedule(), true);
		this.registerDomEvent(win, 'resize', () => this.schedule());
		this.registerDomEvent(win, 'unload', () => this.unload());
		this.resize = resize;
		this.schedule();
	}

	settingsChanged(): void {
		this.root.style.setProperty('--vim-reading-nav-focus-opacity', String(this.settings.readingFocusOpacity / 100));
		this.schedule();
	}
	private resize: ResizeObserver | null = null;

	private schedule(): void {
		const win = this.doc.defaultView;
		if (!this.active || !win || this.frame !== null) return;
		this.frame = win.requestAnimationFrame(() => {
			this.frame = null;
			this.update();
		});
	}

	private collectBlocks(): void {
		this.blocks.forEach((block) => block.classList.remove(DIM_CLASS));
		this.resize?.disconnect();
		// Only direct renderer blocks: never descend into lists, embeds or previews.
		const sizer = this.root.querySelector(':scope > .markdown-preview-sizer');
		this.blocks = sizer ? Array.from(sizer.children).filter(
			(el): el is HTMLElement => el.instanceOf(HTMLElement)
				&& Array.from(el.classList).some((name) => name.startsWith('el-')),
		) : [];
		this.resize?.observe(this.root);
		this.blocks.forEach((block) => this.resize?.observe(block));
		this.dirty = false;
	}

	private update(): void {
		if (!this.root.isConnected) {
			this.refreshView();
			return;
		}
		if (this.dirty) this.collectBlocks();
		const bounds = this.root.getBoundingClientRect();
		const top = bounds.top + this.root.clientTop;
		const bottom = top + this.root.clientHeight;
		const maxScroll = Math.max(0, this.root.scrollHeight - this.root.clientHeight);
		const scroll = Math.min(maxScroll, Math.max(0, this.root.scrollTop));
		const halfHeight = this.root.clientHeight / 2;
		const edge = Math.min(halfHeight, maxScroll / 2);
		// At either scroll limit the center cannot reach the first/last blocks.
		// Move the anchor toward that edge, continuously returning to center.
		let center = top + halfHeight;
		if (edge > 0 && scroll < edge) center = top + halfHeight * scroll / edge;
		else if (edge > 0 && maxScroll - scroll < edge) {
			center = bottom - halfHeight * (maxScroll - scroll) / edge;
		}
		const rendered = this.blocks.map((block) => ({ block, rect: block.getBoundingClientRect() }))
			.filter(({ rect }) => rect.height > 0 && rect.width > 0);
		let nearest = -1;
		let distance = Infinity;
		rendered.forEach(({ rect }, index) => {
			if (rect.bottom <= top || rect.top >= bottom) return;
			// A block spanning the center wins, including very tall tables/lists.
			const gap = Math.max(rect.top - center, center - rect.bottom, 0);
			if (gap < distance) {
				distance = gap;
				nearest = index;
			}
		});
		const context = this.settings.readingFocusContextBlocks;
		const bright = new Set(rendered.slice(Math.max(0, nearest - context), nearest + context + 1)
			.map(({ block }) => block));
		this.blocks.forEach((block) => {
			block.classList.toggle(DIM_CLASS, maxScroll > 0 && nearest >= 0 && !bright.has(block));
		});
	}
}
