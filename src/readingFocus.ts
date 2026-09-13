import { Component, MarkdownView, Notice, setTooltip, type Plugin } from 'obsidian';
import { ReadingFocusPane } from './readingFocusPane';
import { getPreviewViewIn, getScrollElement, isFocusInModal } from './viewUtils';
import type { VimReadingNavSettings } from './settings';

export class ReadingFocus {
	private enabled = false;
	private pane: ReadingFocusPane | null = null;
	private container: HTMLElement | null = null;
	private observer: MutationObserver | null = null;
	private actionView: MarkdownView | null = null;
	private action: HTMLElement | null = null;
	private actionOwner: Component | null = null;
	private notice: Notice | null = null;

	constructor(
		private readonly plugin: Plugin,
		private readonly settings: VimReadingNavSettings,
	) {}

	register(): void {
		const workspace = this.plugin.app.workspace;
		this.plugin.registerEvent(workspace.on('active-leaf-change', () => this.refresh()));
		this.plugin.registerEvent(workspace.on('layout-change', () => this.refresh()));
		this.plugin.registerEvent(workspace.on('window-close', (win) => {
			if (this.container?.ownerDocument === win.doc) this.clear();
		}));
		this.plugin.register(() => {
			this.enabled = false;
			this.notice?.hide();
			this.clear();
		});
		this.refresh();
	}

	registerTo(doc: Document): void {
		this.plugin.registerDomEvent(doc, 'keydown', (evt: KeyboardEvent) => {
			if (evt.defaultPrevented || evt.key !== 'z' || evt.ctrlKey || evt.metaKey
				|| evt.altKey || evt.shiftKey || evt.isComposing) return;
			if (isFocusInModal(evt, doc) || !getPreviewViewIn(this.plugin.app, doc)) return;
			evt.preventDefault();
			if (!evt.repeat) this.toggle();
		});
	}

	settingsChanged(): void {
		this.pane?.settingsChanged();
	}

	toggle(): void {
		this.enabled = !this.enabled;
		this.refresh();
		this.notice?.hide();
		this.notice = new Notice(this.enabled ? 'Reading focus on' : 'Reading focus off', 1500);
	}

	private refresh(): void {
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		const container = view?.containerEl ?? null;
		if (container !== this.container) {
			this.clear();
			this.container = container;
			if (container) {
				// Also watch while off: the header toggle must appear when Reading DOM mounts.
				this.observer = new MutationObserver(() => this.refresh());
				this.observer.observe(container, { childList: true, subtree: true });
			}
		}
		const reading = container && getPreviewViewIn(this.plugin.app, container.ownerDocument);
		this.syncAction(reading);
		const root = this.enabled && reading ? getScrollElement(reading) : null;
		const mounted = root?.isConnected ? root : null;
		if (this.pane?.root === mounted && this.pane?.doc === mounted?.ownerDocument) return;
		if (this.pane) this.plugin.removeChild(this.pane);
		this.pane = mounted && container
			? this.plugin.addChild(new ReadingFocusPane(mounted, container, () => this.refresh(), this.settings))
			: null;
	}

	private syncAction(view: MarkdownView | null): void {
		if (view !== this.actionView || (view && !this.action?.isConnected)) {
			if (this.actionOwner) this.plugin.removeChild(this.actionOwner);
			this.actionOwner = null;
			this.action = null;
			this.actionView = view;
			if (view) {
				const owner = this.plugin.addChild(new Component());
				const action = view.addAction('focus', 'Toggle reading focus', () => this.toggle());
				action.classList.add('vim-reading-nav-focus-action');
				action.setAttribute('role', 'button');
				action.tabIndex = 0;
				owner.register(() => action.remove());
				owner.registerDomEvent(action, 'keydown', (evt) => {
					if (evt.key !== 'Enter' && evt.key !== ' ') return;
					evt.preventDefault();
					evt.stopPropagation();
					if (!evt.repeat) this.toggle();
				});
				this.actionOwner = owner;
				this.action = action;
			}
		}
		if (this.action) {
			this.action.setAttribute('aria-pressed', String(this.enabled));
			this.action.classList.toggle('is-active', this.enabled);
			setTooltip(this.action, this.enabled ? 'Turn off reading focus (z)' : 'Turn on reading focus (z)');
		}
	}

	private clear(): void {
		this.observer?.disconnect();
		this.observer = null;
		this.container = null;
		if (this.pane) this.plugin.removeChild(this.pane);
		this.pane = null;
		this.syncAction(null);
	}
}
