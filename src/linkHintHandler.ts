import { MarkdownView, Plugin } from 'obsidian';
import { PersistentLinkPreview } from './persistentLinkPreview';
import { getPreviewViewIn, getScrollElement, isFocusInModal } from './viewUtils';

const HINT_CHARS = 'asdfghjklqwertyuiopzxcvbnm';

interface Hint {
	label: string;
	link: HTMLAnchorElement;
	el: HTMLElement;
	sourcePath: string;
}

interface FocusedLink {
	link: HTMLAnchorElement;
	linktext: string;
	sourcePath: string;
}

/** Vimium-style link hint mode for reading mode. */
export class LinkHintHandler {
	private readonly plugin: Plugin;
	private readonly preview: PersistentLinkPreview;
	private hints: Hint[] = [];
	private typed = '';
	private active = false;
	private hintDoc: Document | null = null;
	private focusedLink: FocusedLink | null = null;

	constructor(plugin: Plugin) {
		this.plugin = plugin;
		this.preview = new PersistentLinkPreview(plugin.app);
	}

	register(): void {
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('active-leaf-change', () => this.cleanup())
		);
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('layout-change', () => this.cleanup())
		);
		this.plugin.register(() => this.cleanup());
	}

	registerTo(doc: Document): void {
		this.plugin.registerDomEvent(doc, 'keydown', (evt: KeyboardEvent) => {
			this.handleKeyDown(evt, doc);
		});
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
				this.preview.reposition();
			});
		}
	}

	cleanup(): void {
		this.exitHintMode();
		this.clearFocus();
		this.preview.close();
	}

	private handleKeyDown(evt: KeyboardEvent, doc: Document): void {
		if (isFocusInModal(evt, doc)) return;
		if (this.active) {
			if (doc !== this.hintDoc) this.exitHintMode();
			else this.handleHintKey(evt);
			return;
		}

		const ownsFocusedDocument = this.focusedLink?.link.ownerDocument === doc;
		if (
			ownsFocusedDocument &&
			this.preview.isOpen() &&
			evt.shiftKey &&
			!evt.ctrlKey &&
			!evt.metaKey &&
			!evt.altKey
		) {
			const key = evt.key.toLowerCase();
			if (key === 'j' || key === 'k') {
				this.consume(evt);
				this.preview.scroll(key === 'j' ? 'down' : 'up');
				return;
			}
		}

		if (ownsFocusedDocument && this.focusedLink) {
			if (evt.key === 'Enter') {
				this.consume(evt);
				const focused = this.focusedLink;
				this.clearFocus();
				this.preview.close();
				void this.plugin.app.workspace.openLinkText(
					focused.linktext,
					focused.sourcePath,
					false
				);
				return;
			}
			if (evt.key === 'Escape') {
				this.consume(evt);
				this.clearFocus();
				this.preview.close();
				return;
			}
		}

		const view = getPreviewViewIn(this.plugin.app, doc);
		if (!view) return;
		if (evt.ctrlKey || evt.metaKey || evt.altKey) return;
		if (evt.key === 'f') {
			this.consume(evt);
			this.enterHintMode(view);
		}
	}

	private enterHintMode(view: MarkdownView): void {
		this.cleanup();
		const scrollEl = getScrollElement(view);
		const sourcePath = view.file?.path;
		if (!scrollEl || !sourcePath) return;
		const links = this.getVisibleLinks(scrollEl);
		if (links.length === 0) return;
		const doc = view.containerEl.ownerDocument;
		const labels = this.generateLabels(links.length);
		this.active = true;
		this.hintDoc = doc;
		links.forEach((link, index) => {
			const label = labels[index];
			if (!label) return;
			this.hints.push({
				label,
				link,
				el: this.createHintEl(label, link, doc),
				sourcePath,
			});
		});
	}

	private handleHintKey(evt: KeyboardEvent): void {
		if (evt.ctrlKey || evt.metaKey || evt.altKey) {
			this.exitHintMode();
			return;
		}
		this.consume(evt);
		if (evt.key === 'Escape') {
			this.exitHintMode();
			return;
		}
		if (evt.key === 'Backspace') {
			this.typed = this.typed.slice(0, -1);
			this.updateHintDisplay();
			return;
		}
		if (evt.key.length !== 1 || !HINT_CHARS.includes(evt.key.toLowerCase())) return;
		this.typed += evt.key.toLowerCase();
		const matches = this.hints.filter((hint) => hint.label.startsWith(this.typed));
		if (matches.length === 0) {
			this.exitHintMode();
			return;
		}
		const exact = matches.find((hint) => hint.label === this.typed);
		if (exact && matches.length === 1) {
			this.exitHintMode();
			if (exact.link.classList.contains('internal-link')) this.focusLink(exact);
			else this.activateExternalLink(exact.link);
			return;
		}
		this.updateHintDisplay();
	}

	private focusLink(hint: Hint): void {
		const linktext = hint.link.getAttribute('data-href') ?? hint.link.getAttribute('href');
		if (!linktext) return;
		this.focusedLink = { link: hint.link, linktext, sourcePath: hint.sourcePath };
		hint.link.addClass('vim-reading-nav-link-focused');
		hint.link.scrollIntoView({ block: 'center', behavior: 'auto' });
		void this.preview.open(linktext, hint.sourcePath, hint.link);
	}

	private clearFocus(): void {
		if (!this.focusedLink) return;
		this.focusedLink.link.removeClass('vim-reading-nav-link-focused');
		this.focusedLink = null;
	}

	private exitHintMode(): void {
		this.hints.forEach((hint) => hint.el.remove());
		this.hints = [];
		this.typed = '';
		this.active = false;
		this.hintDoc = null;
	}

	private updateHintDisplay(): void {
		this.hints.forEach((hint) => {
			hint.el.toggleClass('vim-reading-nav-hint-inactive', !hint.label.startsWith(this.typed));
		});
	}

	private activateExternalLink(link: HTMLAnchorElement): void {
		const href = link.getAttribute('href');
		if (href) (link.ownerDocument.defaultView ?? window).open(href, '_blank');
	}

	private getVisibleLinks(scrollEl: HTMLElement): HTMLAnchorElement[] {
		const links = Array.from(scrollEl.querySelectorAll<HTMLAnchorElement>(
			'a.internal-link, a.external-link, a[href^="http"]'
		));
		const bounds = scrollEl.getBoundingClientRect();
		return links.filter((link) => {
			// Embedded notes have their own relative-link source path, which the
			// public render DOM contract does not expose. Exclude them rather than
			// previewing or navigating to an incorrectly resolved destination.
			if (link.closest('.markdown-embed')) return false;
			const rect = link.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom;
		});
	}

	private createHintEl(label: string, link: HTMLAnchorElement, doc: Document): HTMLElement {
		const rect = link.getBoundingClientRect();
		const el = doc.body.createSpan({
			cls: 'vim-reading-nav-hint',
			text: label.toUpperCase(),
		});
		el.style.left = `${rect.left}px`;
		el.style.top = `${rect.top + rect.height / 2}px`;
		return el;
	}

	private generateLabels(count: number): string[] {
		const chars = HINT_CHARS.split('');
		if (count <= chars.length) return chars.slice(0, count);
		const labels: string[] = [];
		for (const first of chars) {
			for (const second of chars) {
				labels.push(first + second);
				if (labels.length >= count) return labels;
			}
		}
		return labels;
	}

	private consume(evt: KeyboardEvent): void {
		evt.preventDefault();
		evt.stopImmediatePropagation();
	}
}
