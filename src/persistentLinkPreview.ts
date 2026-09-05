import {
	App,
	Component,
	MarkdownRenderer,
	parseLinktext,
	resolveSubpath,
	TFile,
} from 'obsidian';

import { footnoteDefinitionBodyMarkdown } from './footnoteResolver';
const SCROLL_STEP = 120;

/** Renders and owns the lifetime of one persistent Reading-mode preview. */
export class PersistentLinkPreview {
	private readonly app: App;
	private readonly renderComponents = new Set<Component>();
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
		const { shellEl, generation } = this.start(linktext, targetEl);
		const parsed = parseLinktext(linktext);
		const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
		const file = parsed.path
			? this.app.metadataCache.getFirstLinkpathDest(parsed.path, sourcePath)
			: sourceFile instanceof TFile ? sourceFile : null;
		if (!file) return this.showStatus(shellEl, 'Could not find linked note.');
		if (file.extension !== 'md') return this.showStatus(shellEl, 'Preview is available for Markdown notes only.');

		try {
			const source = await this.app.vault.cachedRead(file);
			if (!this.isCurrent(generation, shellEl)) return;
			const markdown = this.getMarkdownRange(source, file, parsed.subpath);
			if (markdown === null) return this.showStatus(shellEl, 'Could not resolve linked section.');
			await this.renderMarkdown(markdown, file.path, targetEl, shellEl, generation);
		} catch (error) {
			if (this.isCurrent(generation, shellEl)) {
				console.error('Vim Reading Navigation: failed to render link preview', error);
				this.showStatus(shellEl, 'Could not load linked note.');
			}
		}
	}

	async openFootnote(markdown: string, sourcePath: string, targetEl: HTMLElement): Promise<void> {
		const { shellEl, generation } = this.startCompact(targetEl);
		await this.renderMarkdown(markdown, sourcePath, targetEl, shellEl, generation);
	}

	openStatus(title: string, message: string, targetEl: HTMLElement): void {
		const { shellEl } = this.start(title, targetEl);
		this.showStatus(shellEl, message);
		this.position(shellEl, targetEl);
	}

	openFootnoteStatus(message: string, targetEl: HTMLElement): void {
		const { shellEl } = this.startCompact(targetEl);
		this.showStatus(shellEl, message);
		this.position(shellEl, targetEl);
	}

	openExternal(url: URL, targetEl: HTMLElement): void {
		const { shellEl } = this.startCompact(targetEl);
		const bodyEl = shellEl.createDiv({
			cls: 'vim-reading-nav-preview-body vim-reading-nav-external-preview',
		});
		this.replaceStatus(shellEl, bodyEl);
		this.bodyEl = bodyEl;
		bodyEl.createDiv({ cls: 'vim-reading-nav-external-url', text: url.href });
		this.position(shellEl, targetEl);
	}

	scroll(direction: 'up' | 'down'): void {
		if (this.bodyEl) this.bodyEl.scrollTop += direction === 'down' ? SCROLL_STEP : -SCROLL_STEP;
	}

	reposition(): void {
		if (this.shellEl && this.targetEl?.isConnected) this.position(this.shellEl, this.targetEl);
	}

	close(): void {
		this.requestGeneration++;
		for (const component of this.renderComponents) component.unload();
		this.renderComponents.clear();
		this.renderComponent = null;
		this.bodyEl = null;
		this.targetEl = null;
		this.shellEl?.remove();
		this.shellEl = null;
	}

	private start(title: string, targetEl: HTMLElement): { shellEl: HTMLElement; generation: number } {
		this.close();
		const generation = ++this.requestGeneration;
		const shellEl = this.createShell(targetEl.ownerDocument, title);
		this.shellEl = shellEl;
		this.targetEl = targetEl;
		this.position(shellEl, targetEl);
		return { shellEl, generation };
	}

	private startCompact(targetEl: HTMLElement): { shellEl: HTMLElement; generation: number } {
		this.close();
		const generation = ++this.requestGeneration;
		const shellEl = this.createShell(targetEl.ownerDocument);
		this.shellEl = shellEl;
		this.targetEl = targetEl;
		this.position(shellEl, targetEl);
		return { shellEl, generation };
	}

	private async renderMarkdown(
		markdown: string,
		sourcePath: string,
		targetEl: HTMLElement,
		shellEl: HTMLElement,
		generation: number,
	): Promise<void> {
		let component: Component | null = null;
		let bodyEl: HTMLElement | null = null;
		let rendered = false;
		try {
			bodyEl = shellEl.createDiv({ cls: 'vim-reading-nav-preview-body markdown-rendered' });
			this.replaceStatus(shellEl, bodyEl);
			component = new Component();
			component.load();
			this.renderComponents.add(component);
			this.renderComponent = component;
			this.bodyEl = bodyEl;

			await MarkdownRenderer.render(this.app, markdown, bodyEl, sourcePath, component);
			if (!this.isCurrent(generation, shellEl)) return;
			rendered = true;
			this.position(shellEl, targetEl);
		} catch (error) {
			if (this.isCurrent(generation, shellEl)) {
				console.error('Vim Reading Navigation: failed to render preview', error);
				if (this.renderComponent === component) this.renderComponent = null;
				if (this.bodyEl === bodyEl) this.bodyEl = null;
				bodyEl?.remove();
				this.showStatus(shellEl, 'Could not render preview.');
			}
		} finally {
			if (component && (!rendered || !this.isCurrent(generation, shellEl))) {
				if (this.renderComponents.delete(component)) component.unload();
				bodyEl?.remove();
				if (this.renderComponent === component) this.renderComponent = null;
				if (this.bodyEl === bodyEl) this.bodyEl = null;
			}
		}
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
		return range.type === 'footnote' ? footnoteDefinitionBodyMarkdown(markdown) : markdown;
	}

	private createShell(doc: Document, title?: string): HTMLElement {
		const shellEl = doc.body.createEl('section', {
			cls: title ? 'vim-reading-nav-preview' : 'vim-reading-nav-preview vim-reading-nav-preview-compact',
		});
		if (title) {
			const headerEl = shellEl.createEl('header', { cls: 'vim-reading-nav-preview-header' });
			headerEl.createSpan({ cls: 'vim-reading-nav-preview-title', text: title });
		}
		shellEl.createDiv({ cls: 'vim-reading-nav-preview-status', text: 'Loading preview…' });
		return shellEl;
	}

	private replaceStatus(shellEl: HTMLElement, bodyEl: HTMLElement): void {
		const statusEl = shellEl.querySelector<HTMLElement>('.vim-reading-nav-preview-status');
		if (statusEl) statusEl.replaceWith(bodyEl);
		else shellEl.append(bodyEl);
	}

	private showStatus(shellEl: HTMLElement, message: string): void {
		const statusEl = shellEl.querySelector<HTMLElement>('.vim-reading-nav-preview-status');
		if (statusEl) statusEl.textContent = message;
		else shellEl.createDiv({ cls: 'vim-reading-nav-preview-status', text: message });
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
