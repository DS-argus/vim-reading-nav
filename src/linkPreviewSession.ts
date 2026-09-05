import type VimReadingNavPlugin from './main';
import { FootnoteResolver } from './footnoteResolver';
import type { FootnoteReference } from './footnoteResolver';
import { PersistentLinkPreview } from './persistentLinkPreview';

export type FocusedTarget =
	| { kind: 'internal'; link: HTMLAnchorElement; linktext: string; sourcePath: string }
	| { kind: 'standardFootnote'; link: HTMLAnchorElement; sourcePath: string; id: string }
	| { kind: 'inlineFootnote'; link: HTMLAnchorElement }
	| { kind: 'external'; link: HTMLAnchorElement; url: URL };

/** Parses only absolute web URLs suitable for an external-link hint. */
export function parseHttpUrl(href: string | null): URL | null {
	if (!href) return null;
	try {
		const url = new URL(href);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
	} catch {
		return null;
	}
}

/** Owns focused-link state and its persistent preview for one Document. */
export class LinkPreviewSession {
	private readonly preview: PersistentLinkPreview;
	private focusedTarget: FocusedTarget | null = null;
	private footnoteGeneration = 0;

	constructor(
		private readonly plugin: VimReadingNavPlugin,
		private readonly footnotes: FootnoteResolver,
		private readonly doc: Document,
	) {
		this.preview = new PersistentLinkPreview(plugin.app);
	}

	focusHint(link: HTMLAnchorElement, sourcePath: string, footnote: FootnoteReference | undefined): void {
		if (!this.isValidLink(link)) return;
		this.clear(true);
		if (footnote) {
			this.focusFootnote(link, sourcePath, footnote);
			return;
		}
		if (link.classList.contains('internal-link')) {
			this.focusInternal(link, sourcePath);
			return;
		}
		const url = parseHttpUrl(link.getAttribute('href'));
		if (!url) return;
		if (this.plugin.settings.openExternalLinksImmediately) {
			this.openExternal(url, link);
			return;
		}
		this.focusedTarget = { kind: 'external', link, url };
		this.focusElement(link);
		if (this.isValidFocusedTarget()) this.preview.openExternal(url, link);
	}

	/** Returns true when the event belongs to an existing focused target. */
	handleKey(evt: KeyboardEvent): boolean {
		const focused = this.focusedTarget;
		if (!focused) return false;
		if (!this.isValidFocusedTarget()) {
			this.clear(true);
			return true;
		}
		if (this.preview.isOpen() && evt.shiftKey && !evt.ctrlKey && !evt.metaKey && !evt.altKey) {
			const key = evt.key.toLowerCase();
			if (key === 'j' || key === 'k') {
				this.consume(evt);
				this.preview.scroll(key === 'j' ? 'down' : 'up');
				return true;
			}
		}
		if (evt.key === 'Enter') {
			this.consume(evt);
			this.activate(focused);
			return true;
		}
		if (evt.key === 'Escape') {
			this.consume(evt);
			this.clear(true);
			return true;
		}
		return false;
	}

	resize(): void {
		if (this.isValidFocusedTarget()) this.preview.reposition();
		else this.clear(true);
	}

	reapInvalid(): void {
		if (this.focusedTarget && !this.isValidFocusedTarget()) this.clear(true);
	}

	reset(): void {
		this.clear(true);
	}

	dispose(): void {
		this.clear(true);
	}

	private focusInternal(link: HTMLAnchorElement, sourcePath: string): void {
		const linktext = link.getAttribute('data-href') ?? link.getAttribute('href');
		if (!linktext) return;
		this.focusedTarget = { kind: 'internal', link, linktext, sourcePath };
		this.focusElement(link);
		if (this.isValidFocusedTarget()) void this.preview.open(linktext, sourcePath, link);
	}

	private focusFootnote(link: HTMLAnchorElement, sourcePath: string, footnote: FootnoteReference): void {
		if (footnote.kind === 'inline') {
			this.focusedTarget = { kind: 'inlineFootnote', link };
			this.focusElement(link);
			if (this.isValidFocusedTarget()) {
				void this.preview.openFootnote(footnote.markdown, sourcePath, link);
			}
			return;
		}
		this.focusedTarget = { kind: 'standardFootnote', link, sourcePath, id: footnote.id };
		this.focusElement(link);
		if (!this.isValidFocusedTarget()) return;
		const request = ++this.footnoteGeneration;
		void this.openStandardFootnote(request, footnote.id, sourcePath, link);
	}

	private async openStandardFootnote(
		request: number,
		id: string,
		sourcePath: string,
		targetEl: HTMLAnchorElement,
	): Promise<void> {
		try {
			const markdown = await this.footnotes.definitionMarkdown(sourcePath, id);
			if (!this.isCurrentStandardFootnote(request, id, sourcePath, targetEl)) return;
			if (markdown === null) {
				this.preview.openFootnoteStatus('Could not find footnote definition.', targetEl);
				return;
			}
			await this.preview.openFootnote(markdown, sourcePath, targetEl);
			if (!this.isCurrentStandardFootnote(request, id, sourcePath, targetEl)) return;
		} catch (error) {
			if (!this.isCurrentStandardFootnote(request, id, sourcePath, targetEl)) return;
			console.error('Vim Reading Navigation: failed to load footnote preview', error);
			this.preview.openFootnoteStatus('Could not load footnote definition.', targetEl);
		}
	}

	private isCurrentStandardFootnote(request: number, id: string, sourcePath: string, targetEl: HTMLAnchorElement): boolean {
		const focused = this.focusedTarget;
		return this.footnoteGeneration === request
			&& focused?.kind === 'standardFootnote'
			&& focused.id === id
			&& focused.sourcePath === sourcePath
			&& focused.link === targetEl
			&& this.isValidFocusedTarget();
	}

	private activate(focused: FocusedTarget): void {
		if (!this.isValidFocusedTarget()) {
			this.clear(true);
			return;
		}
		if (focused.kind === 'inlineFootnote') return;
		this.clear(true);
		if (focused.kind === 'internal') {
			void this.plugin.app.workspace.openLinkText(focused.linktext, focused.sourcePath, false);
		} else if (focused.kind === 'standardFootnote') {
			focused.link.click();
		} else {
			this.openExternal(focused.url, focused.link);
		}
	}

	private openExternal(url: URL, link: HTMLAnchorElement): void {
		link.ownerDocument.defaultView?.open(url.href, '_blank');
	}

	private focusElement(link: HTMLAnchorElement): void {
		if (!this.isValidLink(link)) {
			this.clear(true);
			return;
		}
		link.addClass('vim-reading-nav-link-focused');
		link.scrollIntoView({ block: 'center', behavior: 'auto' });
	}

	private clear(closePreview: boolean): void {
		this.footnoteGeneration++;
		this.focusedTarget?.link.removeClass('vim-reading-nav-link-focused');
		this.focusedTarget = null;
		if (closePreview) this.preview.close();
	}

	private isValidFocusedTarget(): boolean {
		return this.focusedTarget !== null && this.isValidLink(this.focusedTarget.link);
	}

	private isValidLink(link: HTMLAnchorElement): boolean {
		return link.isConnected && link.ownerDocument === this.doc;
	}

	private consume(evt: KeyboardEvent): void {
		evt.preventDefault();
		evt.stopImmediatePropagation();
	}
}
