import { MarkdownView, Plugin } from 'obsidian';
import { getPreviewViewIn, getScrollElement, isFocusInModal, isVimModeEnabled } from './viewUtils';

const HINT_CHARS = 'asdfghjklqwertyuiopzxcvbnm';
const HOVER_LINK_SOURCE = 'vim-reading-nav';

interface Hint {
	label: string;
	link: HTMLAnchorElement;
	el: HTMLElement;
}

/**
 * Vimium-style link hint mode for reading mode.
 *
 * Press `f` to label every visible link with a hint. Typing an exact hint
 * focuses an internal link and triggers Obsidian's page preview popover.
 * An external-link hint opens the URL immediately. Press Enter to activate a
 * focused internal link or Escape to clear the focus.
 */
export class LinkHintHandler {
	private plugin: Plugin;
	private hints: Hint[] = [];
	private typed = '';
	private active = false;
	/** Document the current hint overlays live in (main or pop-out window). */
	private hintDoc: Document | null = null;
	private focusedLink: HTMLAnchorElement | null = null;
	// Reused across hover-link triggers so the Page Preview plugin can dedupe
	// and replace the previous popover instead of stacking new ones.
	private hoverParent: { hoverPopover: unknown } = { hoverPopover: null };

	constructor(plugin: Plugin) {
		this.plugin = plugin;
	}

	/** One-time registration of window-independent hooks. */
	register(): void {
		// Register as a hover source so the Page Preview core plugin shows
		// popovers for hover-link events triggered by this plugin.
		this.plugin.registerHoverLinkSource(HOVER_LINK_SOURCE, {
			display: 'Vim Reading Navigation',
			defaultMod: false,
		});

		// Reset transient state when the user switches panes or toggles between
		// reading and editing mode, so no hints or highlights are left stranded.
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('active-leaf-change', () => this.cleanup())
		);
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('layout-change', () => this.cleanup())
		);
	}

	/** Attach DOM listeners to one document (main window or pop-out). */
	registerTo(doc: Document): void {
		this.plugin.registerDomEvent(doc, 'keydown', (evt: KeyboardEvent) => {
			this.handleKeyDown(evt, doc);
		});

		// Dismiss hints when the document scrolls or the window resizes — the
		// fixed-position overlays would otherwise drift away from their links.
		// scroll doesn't bubble, so listen in the capture phase.
		this.plugin.registerDomEvent(
			doc,
			'scroll',
			() => { if (this.active) this.exitHintMode(); },
			{ capture: true }
		);
		const win = doc.defaultView;
		if (win) {
			this.plugin.registerDomEvent(win, 'resize', () => {
				if (this.active) this.exitHintMode();
			});
		}
	}

	/** Tear down all transient state (hints + focus). Safe to call any time. */
	cleanup(): void {
		this.exitHintMode();
		this.clearFocus();
	}

	private handleKeyDown(evt: KeyboardEvent, doc: Document): void {
		// Don't intercept keys when a modal/dialog is open or focus is in an input
		if (isFocusInModal(evt, doc)) return;

		// While hint mode is active, every key in the hint window drives hint
		// selection. Keys from any other window just dismiss hint mode.
		if (this.active) {
			if (doc !== this.hintDoc) {
				this.exitHintMode();
				return;
			}
			this.handleHintKey(evt);
			return;
		}

		// While a link is focused, Enter activates it and Escape clears it.
		// Other keys fall through so j/k scrolling keeps working.
		if (this.focusedLink) {
			if (evt.key === 'Enter') {
				evt.preventDefault();
				evt.stopImmediatePropagation();
				const link = this.focusedLink;
				this.clearFocus();
				this.activateLink(link);
				return;
			}
			if (evt.key === 'Escape') {
				evt.preventDefault();
				this.clearFocus();
				return;
			}
		}

		const view = getPreviewViewIn(this.plugin.app, doc);
		if (!view) return;
		if (!isVimModeEnabled(this.plugin.app)) return;

		const { key, ctrlKey, metaKey, altKey } = evt;
		if (ctrlKey || metaKey || altKey) return;

		if (key === 'f') {
			evt.preventDefault();
			evt.stopImmediatePropagation();
			this.enterHintMode(view);
		}
	}

	private enterHintMode(view: MarkdownView): void {
		this.clearFocus();
		this.exitHintMode();

		const scrollEl = getScrollElement(view);
		if (!scrollEl) return;

		const links = this.getVisibleLinks(scrollEl);
		if (links.length === 0) return;

		const doc = view.containerEl.ownerDocument;
		const labels = this.generateLabels(links.length);
		this.active = true;
		this.hintDoc = doc;
		this.typed = '';

		links.forEach((link, i) => {
			const label = labels[i];
			if (!label) return;
			const el = this.createHintEl(label, link, doc);
			this.hints.push({ label, link, el });
		});
	}

	private handleHintKey(evt: KeyboardEvent): void {
		// Let global hotkeys (Ctrl/Cmd/Alt combos like the command palette)
		// pass through instead of swallowing them. Leaving hint mode avoids
		// stale overlays behind whatever UI the hotkey opens.
		if (evt.ctrlKey || evt.metaKey || evt.altKey) {
			this.exitHintMode();
			return;
		}

		evt.preventDefault();
		evt.stopImmediatePropagation();

		const key = evt.key;
		if (key === 'Escape') {
			this.exitHintMode();
			return;
		}
		if (key === 'Backspace') {
			this.typed = this.typed.slice(0, -1);
			this.updateHintDisplay();
			return;
		}
		if (key.length !== 1 || !HINT_CHARS.includes(key.toLowerCase())) {
			return;
		}

		this.typed += key.toLowerCase();
		const matches = this.hints.filter((h) => h.label.startsWith(this.typed));

		if (matches.length === 0) {
			this.exitHintMode();
			return;
		}

		const exact = matches.find((h) => h.label === this.typed);
		if (exact && matches.length === 1) {
			const link = exact.link;
			this.exitHintMode();
			if (link.classList.contains('internal-link')) {
				this.focusLink(link);
			} else {
				this.activateLink(link);
			}
			return;
		}

		this.updateHintDisplay();
	}

	private updateHintDisplay(): void {
		this.hints.forEach((h) => {
			h.el.toggleClass('vim-reading-nav-hint-inactive', !h.label.startsWith(this.typed));
		});
	}

	private exitHintMode(): void {
		this.hints.forEach((h) => h.el.remove());
		this.hints = [];
		this.typed = '';
		this.active = false;
		this.hintDoc = null;
	}

	private focusLink(link: HTMLAnchorElement): void {
		this.focusedLink = link;
		link.addClass('vim-reading-nav-link-focused');
		// behavior: 'auto' defeats any inherited smooth-scroll so the jump stays
		// instant, matching the scroll handler's direct scrollTop assignments.
		link.scrollIntoView({ block: 'center', behavior: 'auto' });
		if (link.classList.contains('internal-link')) {
			this.showHoverPreview(link);
		}
	}

	private clearFocus(): void {
		if (this.focusedLink) {
			this.focusedLink.removeClass('vim-reading-nav-link-focused');
			this.focusedLink = null;
		}
	}

	private showHoverPreview(link: HTMLAnchorElement): void {
		const linktext = link.getAttribute('data-href') ?? link.getAttribute('href');
		if (!linktext) return;

		const rect = link.getBoundingClientRect();
		const event = new MouseEvent('mouseover', {
			clientX: rect.left,
			clientY: rect.bottom,
		});

		this.plugin.app.workspace.trigger('hover-link', {
			event,
			source: HOVER_LINK_SOURCE,
			hoverParent: this.hoverParent,
			targetEl: link,
			linktext,
			sourcePath: this.getSourcePath(),
		});
	}

	private activateLink(link: HTMLAnchorElement): void {
		if (link.classList.contains('internal-link')) {
			const linktext = link.getAttribute('data-href') ?? link.getAttribute('href');
			if (!linktext) return;
			void this.plugin.app.workspace.openLinkText(linktext, this.getSourcePath(), false);
			return;
		}

		const href = link.getAttribute('href');
		if (href) {
			// Open from the link's own window so this works in pop-outs too.
			(link.ownerDocument.defaultView ?? window).open(href, '_blank');
		}
	}

	private getSourcePath(): string {
		return this.plugin.app.workspace.getActiveFile()?.path ?? '';
	}

	private getVisibleLinks(scrollEl: HTMLElement): HTMLAnchorElement[] {
		const all = Array.from(
			scrollEl.querySelectorAll<HTMLAnchorElement>(
				'a.internal-link, a.external-link, a[href^="http"]'
			)
		);
		const containerRect = scrollEl.getBoundingClientRect();
		return all.filter((a) => {
			const r = a.getBoundingClientRect();
			return (
				r.width > 0 &&
				r.height > 0 &&
				r.bottom > containerRect.top &&
				r.top < containerRect.bottom
			);
		});
	}

	private createHintEl(label: string, link: HTMLAnchorElement, doc: Document): HTMLElement {
		const rect = link.getBoundingClientRect();
		const el = doc.body.createDiv({
			cls: 'vim-reading-nav-hint',
			text: label.toUpperCase(),
		});
		el.setCssStyles({
			left: `${rect.left}px`,
			top: `${rect.top + rect.height / 2}px`,
		});
		return el;
	}

	private generateLabels(count: number): string[] {
		const chars = HINT_CHARS.split('');
		const labels: string[] = [];

		if (count <= chars.length) {
			for (let i = 0; i < count; i++) {
				const c = chars[i];
				if (c) labels.push(c);
			}
			return labels;
		}

		for (const a of chars) {
			for (const b of chars) {
				labels.push(a + b);
				if (labels.length >= count) return labels;
			}
		}
		return labels;
	}
}
