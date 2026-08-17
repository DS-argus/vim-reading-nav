import {
	App,
	Component,
	MarkdownRenderer,
	parseLinktext,
	resolveSubpath,
	TFile,
} from 'obsidian';

const SCROLL_STEP = 120;

/** Renders and owns the lifetime of one persistent internal-link preview. */
export class PersistentLinkPreview {
	private readonly app: App;
	private readonly pendingComponents = new Set<Component>();
	private requestGeneration = 0;
	private shellEl: HTMLElement | null = null;
	private renderComponent: Component | null = null;
	private bodyEl: HTMLElement | null = null;
	private targetEl: HTMLElement | null = null;

	constructor(app: App) {
		this.app = app;
	}

	isOpen(): boolean {
		return this.shellEl !== null;
	}

	async open(linktext: string, sourcePath: string, targetEl: HTMLElement): Promise<void> {
		this.close();
		const generation = ++this.requestGeneration;
		const doc = targetEl.ownerDocument;
		const shellEl = this.createShell(doc, linktext);
		this.shellEl = shellEl;
		this.targetEl = targetEl;
		this.position(shellEl, targetEl);

		const parsed = parseLinktext(linktext);
		const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
		const file = parsed.path
			? this.app.metadataCache.getFirstLinkpathDest(parsed.path, sourcePath)
			: sourceFile instanceof TFile ? sourceFile : null;
		if (!file) {
			this.showStatus(shellEl, 'Could not find linked note.');
			return;
		}
		if (file.extension !== 'md') {
			this.showStatus(shellEl, 'Preview is available for Markdown notes only.');
			return;
		}

		let component: Component | null = null;
		let bodyEl: HTMLElement | null = null;
		let rendered = false;
		try {
			const source = await this.app.vault.cachedRead(file);
			if (!this.isCurrent(generation, shellEl)) return;
			const markdown = this.getMarkdownRange(source, file, parsed.subpath);
			if (markdown === null) {
				this.showStatus(shellEl, 'Could not resolve linked section.');
				return;
			}

			bodyEl = doc.createElement('div');
			bodyEl.className = 'vim-reading-nav-preview-body markdown-rendered';
			this.replaceStatus(shellEl, bodyEl);
			component = new Component();
			component.load();
			this.pendingComponents.add(component);
			this.renderComponent = component;
			this.bodyEl = bodyEl;
			await MarkdownRenderer.render(this.app, markdown, bodyEl, file.path, component);
			if (!this.isCurrent(generation, shellEl)) return;
			rendered = true;
			this.position(shellEl, targetEl);
		} catch (error) {
			if (this.isCurrent(generation, shellEl)) {
				console.error('Vim Reading Navigation: failed to render link preview', error);
				if (this.renderComponent === component) this.renderComponent = null;
				if (this.bodyEl === bodyEl) this.bodyEl = null;
				bodyEl?.remove();
				this.showStatus(shellEl, 'Could not load linked note.');
			}
		} finally {
			if (component) {
				this.pendingComponents.delete(component);
				if (!rendered || !this.isCurrent(generation, shellEl)) {
					component.unload();
					bodyEl?.remove();
					if (this.renderComponent === component) this.renderComponent = null;
					if (this.bodyEl === bodyEl) this.bodyEl = null;
				}
			}
		}
	}

	scroll(direction: 'up' | 'down'): void {
		if (!this.bodyEl) return;
		this.bodyEl.scrollTop += direction === 'down' ? SCROLL_STEP : -SCROLL_STEP;
	}

	reposition(): void {
		if (this.shellEl && this.targetEl?.isConnected) {
			this.position(this.shellEl, this.targetEl);
		}
	}

	close(): void {
		this.requestGeneration++;
		if (this.renderComponent && !this.pendingComponents.has(this.renderComponent)) {
			this.renderComponent.unload();
		}
		this.renderComponent = null;
		this.bodyEl = null;
		this.targetEl = null;
		this.shellEl?.remove();
		this.shellEl = null;
	}

	private isCurrent(generation: number, shellEl: HTMLElement): boolean {
		return generation === this.requestGeneration && this.shellEl === shellEl;
	}

	private getMarkdownRange(source: string, file: TFile, subpath: string): string | null {
		if (!subpath) return source;
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache) return null;
		const range = resolveSubpath(cache, subpath);
		if (!range) return null;
		const markdown = source.slice(range.start.offset, range.end?.offset ?? source.length);
		if (range.type === 'footnote') {
			return `[^${range.footnote.id}]\n\n${markdown}`;
		}
		return markdown;
	}

	private createShell(doc: Document, linktext: string): HTMLElement {
		const shellEl = doc.createElement('section');
		shellEl.className = 'vim-reading-nav-preview';
		const headerEl = doc.createElement('header');
		headerEl.className = 'vim-reading-nav-preview-header';
		const titleEl = doc.createElement('span');
		titleEl.className = 'vim-reading-nav-preview-title';
		titleEl.textContent = linktext;
		headerEl.append(titleEl);
		const statusEl = doc.createElement('div');
		statusEl.className = 'vim-reading-nav-preview-status';
		statusEl.textContent = 'Loading preview…';
		shellEl.append(headerEl, statusEl);
		doc.body.append(shellEl);
		return shellEl;
	}

	private replaceStatus(shellEl: HTMLElement, bodyEl: HTMLElement): void {
		const statusEl = shellEl.querySelector<HTMLElement>('.vim-reading-nav-preview-status');
		if (statusEl) statusEl.replaceWith(bodyEl);
		else shellEl.append(bodyEl);
	}
	private showStatus(shellEl: HTMLElement, message: string): void {
		const statusEl = shellEl.querySelector<HTMLElement>('.vim-reading-nav-preview-status');
		if (statusEl) {
			statusEl.textContent = message;
			return;
		}
		const newStatusEl = shellEl.ownerDocument.createElement('div');
		newStatusEl.className = 'vim-reading-nav-preview-status';
		newStatusEl.textContent = message;
		this.bodyEl?.replaceWith(newStatusEl);
		shellEl.append(newStatusEl);
	}

	private position(shellEl: HTMLElement, targetEl: HTMLElement): void {
		const win = targetEl.ownerDocument.defaultView;
		if (!win) return;
		const target = targetEl.getBoundingClientRect();
		const margin = 12;
		const width = shellEl.getBoundingClientRect().width;
		const height = shellEl.getBoundingClientRect().height;
		let left = target.right + margin;
		if (left + width > win.innerWidth - margin) left = target.left - width - margin;
		left = Math.max(margin, Math.min(left, win.innerWidth - width - margin));
		const top = Math.max(margin, Math.min(target.top, win.innerHeight - height - margin));
		shellEl.style.left = `${left}px`;
		shellEl.style.top = `${top}px`;
	}
}
