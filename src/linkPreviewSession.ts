import type { WorkspaceLeaf } from 'obsidian';
import type VimReadingNavPlugin from './main';
import { FootnoteResolver } from './footnoteResolver';
import type { FootnoteReference } from './footnoteResolver';
import {
	pendingSplitGuidance,
	previewGuidance,
} from './previewGuidance';
import { PersistentLinkPreview } from './persistentLinkPreview';
import {
	SplitLinkNavigator,
} from './splitLinkNavigator';
import type { SplitOpenDirection } from './splitLinkNavigator';

const PENDING_DIRECTION_TIMEOUT_MS = 3000;

export type FocusedTarget =
	| {
		kind: 'internal';
		link: HTMLAnchorElement;
		linktext: string;
		sourcePath: string;
		sourceLeaf: WorkspaceLeaf | null;
		canSplit: boolean;
	}
	| { kind: 'standardFootnote'; link: HTMLAnchorElement; sourcePath: string; id: string }
	| { kind: 'inlineFootnote'; link: HTMLAnchorElement }
	| { kind: 'external'; link: HTMLAnchorElement; url: URL };

interface PendingDirection {
	direction: SplitOpenDirection;
	newPane: boolean;
}

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
	private readonly navigator: SplitLinkNavigator;
	private focusedTarget: FocusedTarget | null = null;
	private footnoteGeneration = 0;
	private pendingDirection: PendingDirection | null = null;
	private pendingTimer: number | null = null;
	private pendingDeadline = 0;
	private splitOpening = false;

	constructor(
		private readonly plugin: VimReadingNavPlugin,
		private readonly footnotes: FootnoteResolver,
		private readonly doc: Document,
	) {
		this.preview = new PersistentLinkPreview(plugin.app);
		this.navigator = new SplitLinkNavigator(plugin);
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
		if (this.isValidFocusedTarget()) {
			this.setGuidance(previewGuidance('external'));
			this.preview.openExternal(url, link);
		}
	}

	/** Returns true when the event belongs to an existing focused target. */
	handleKey(evt: KeyboardEvent): boolean {
		const focused = this.focusedTarget;
		if (!focused) return false;
		if (!this.isValidFocusedTarget()) {
			this.clear(true);
			return true;
		}
		if (this.splitOpening) {
			if (evt.key === 'Escape' && !evt.ctrlKey && !evt.metaKey && !evt.altKey) {
				this.consume(evt);
				this.clear(true);
			} else {
				this.consume(evt);
			}
			return true;
		}

		if (!this.plugin.settings.enableSplitOpening) this.clearPendingDirection();
		let pending = this.pendingDirection;
		if (pending && Date.now() >= this.pendingDeadline) {
			this.clearPendingDirection();
			pending = null;
		}
		if (!pending) {
			const initial = this.directionForKey(evt);
			if (initial && focused.kind === 'internal' && focused.canSplit) {
				this.consume(evt);
				this.setPendingDirection(initial);
				return true;
			}
		} else {
			const replacement = this.directionForKey(evt);
			if (replacement && focused.kind === 'internal' && focused.canSplit) {
				this.consume(evt);
				this.setPendingDirection(replacement);
				return true;
			}
			this.clearPendingDirection();
			if (evt.key === 'Enter' && focused.kind === 'internal' && focused.canSplit) {
				this.consume(evt);
				void this.activateSplit(focused, pending);
				return true;
			}
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
		if (this.focusedTarget && !this.isValidFocusedTarget()) {
			this.clear(true);
			return;
		}
		if (this.pendingDirection && !this.preview.isOpen()) this.clearPendingDirection();
	}

	/** Keep the focused preview alive while its own split open changes active leaf. */
	isOpeningSplit(): boolean {
		return this.splitOpening;
	}

	cancelPendingDirection(): void {
		this.clearPendingDirection();
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
		const sourceLeaf = this.navigator.findSourceLeaf(link);
		const canSplit = sourceLeaf !== null && this.navigator.canSplit(linktext, sourcePath);
		this.focusedTarget = {
			kind: 'internal',
			link,
			linktext,
			sourcePath,
			sourceLeaf,
			canSplit,
		};
		this.focusElement(link);
		if (this.isValidFocusedTarget()) {
			this.setGuidance(previewGuidance('internal', canSplit));
			void this.preview.open(linktext, sourcePath, link);
		}
	}

	private focusFootnote(link: HTMLAnchorElement, sourcePath: string, footnote: FootnoteReference): void {
		if (footnote.kind === 'inline') {
			this.focusedTarget = { kind: 'inlineFootnote', link };
			this.focusElement(link);
			if (this.isValidFocusedTarget()) {
				this.setGuidance(previewGuidance('inlineFootnote'));
				void this.preview.openFootnote(footnote.markdown, sourcePath, link);
			}
			return;
		}
		this.focusedTarget = { kind: 'standardFootnote', link, sourcePath, id: footnote.id };
		this.focusElement(link);
		if (!this.isValidFocusedTarget()) return;
		this.setGuidance(previewGuidance('standardFootnote'));
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

	private async activateSplit(focused: Extract<FocusedTarget, { kind: 'internal' }>, pending: PendingDirection): Promise<void> {
		if (!this.plugin.settings.enableSplitOpening || !focused.sourceLeaf || this.splitOpening) return;
		this.splitOpening = true;
		try {
			const result = await this.navigator.open(
				focused.linktext,
				focused.sourcePath,
				focused.sourceLeaf,
				pending.direction,
				pending.newPane,
				() => this.splitOpening && this.focusedTarget === focused && this.isValidFocusedTarget(),
			);
			if (result.opened) {
				this.clear(true);
				return;
			}
			if (!result.cancelled && this.focusedTarget === focused && this.isValidFocusedTarget()) {
				this.preview.showOpenError(result.error ?? 'Could not open the link in a split pane.');
			}
		} catch (error) {
			console.error('Vim Reading Navigation: failed to activate split link', error);
			if (this.focusedTarget === focused && this.isValidFocusedTarget()) {
				this.preview.showOpenError('Could not open the link in a split pane.');
			}
		} finally {
			this.splitOpening = false;
		}
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
		this.splitOpening = false;
		this.clearPendingDirection(false);
		this.focusedTarget?.link.removeClass('vim-reading-nav-link-focused');
		this.focusedTarget = null;
		if (closePreview) this.preview.close();
	}

	private setPendingDirection(pending: PendingDirection): void {
		this.clearPendingTimer();
		this.pendingDirection = pending;
		this.pendingDeadline = Date.now() + PENDING_DIRECTION_TIMEOUT_MS;
		this.setGuidance(pendingSplitGuidance(pending.direction, pending.newPane));
		const win = this.doc.defaultView;
		if (!win) return;
		const deadline = this.pendingDeadline;
		const expire = (): void => {
			if (this.pendingDirection !== pending || this.pendingDeadline !== deadline) return;
			const remaining = deadline - Date.now();
			if (remaining > 0) {
				this.pendingTimer = win.setTimeout(expire, remaining);
				return;
			}
			this.pendingDirection = null;
			this.pendingDeadline = 0;
			this.pendingTimer = null;
			this.updateGuidance();
		};
		this.pendingTimer = win.setTimeout(expire, PENDING_DIRECTION_TIMEOUT_MS);
	}

	private clearPendingDirection(updateGuidance = true): void {
		const hadPending = this.pendingDirection !== null;
		this.clearPendingTimer();
		this.pendingDirection = null;
		this.pendingDeadline = 0;
		if (hadPending && updateGuidance) this.updateGuidance();
	}

	private clearPendingTimer(): void {
		const win = this.doc.defaultView;
		if (this.pendingTimer !== null && win) win.clearTimeout(this.pendingTimer);
		this.pendingTimer = null;
	}

	private setGuidance(guidance: ReturnType<typeof previewGuidance>): void {
		const settings = this.plugin.settings;
		this.preview.setGuidance(settings.enableSplitOpening && settings.showPreviewOpeningGuidance
			? guidance : { items: [] });
	}
	private updateGuidance(): void {
		const focused = this.focusedTarget;
		if (!focused) return;
		if (focused.kind === 'internal') {
			this.setGuidance(this.pendingDirection
				? pendingSplitGuidance(this.pendingDirection.direction, this.pendingDirection.newPane)
				: previewGuidance('internal', focused.canSplit));
			return;
		}
		this.setGuidance(previewGuidance(focused.kind));
	}

	private directionForKey(evt: KeyboardEvent): PendingDirection | null {
		if (!this.plugin.settings.enableSplitOpening) return null;
		if (evt.ctrlKey || evt.metaKey || evt.altKey) return null;
		if (evt.key === 'v') return { direction: 'right', newPane: false };
		if (evt.key === 'h') return { direction: 'below', newPane: false };
		if (evt.key === 'V') return { direction: 'right', newPane: true };
		if (evt.key === 'H') return { direction: 'below', newPane: true };
		return null;
	}

	private isValidFocusedTarget(): boolean {
		const focused = this.focusedTarget;
		if (!focused || !this.isValidLink(focused.link)) return false;
		return focused.kind !== 'internal'
			|| focused.sourceLeaf === null
			|| this.navigator.isSourceLeafValid(focused.sourceLeaf, focused.link);
	}

	private isValidLink(link: HTMLAnchorElement): boolean {
		return link.isConnected && link.ownerDocument === this.doc;
	}

	private consume(evt: KeyboardEvent): void {
		evt.preventDefault();
		evt.stopImmediatePropagation();
	}
}
