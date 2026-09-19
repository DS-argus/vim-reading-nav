import type { App } from 'obsidian';
import { resolveMarkdownTarget } from './splitLinkNavigator';
import type { FootnoteResolver } from './footnoteResolver';
import { parseHttpUrl } from './linkPreviewSession';
import type { LinkHintTarget } from './linkPreviewSession';

const FOOTNOTE_REFERENCE_SELECTOR = 'a.footnote-link, sup.footnote-ref > a';

/** A resolved, top-level Markdown embed control used as an internal hint target. */
export interface MarkdownEmbedHintTarget {
	kind: 'internal';
	element: HTMLElement;
	root: HTMLElement;
	linktext: string;
	sourcePath: string;
}

/**
 * Collect visible top-level Markdown embeds from a Reading-mode scroll element.
 * The returned element is Obsidian's real `.markdown-embed-link` control; no
 * detached anchor or DOM link attributes are created for hint navigation.
 */
export function collectMarkdownEmbedTargets(
	scrollEl: HTMLElement,
	app: App,
	sourcePath: string,
): MarkdownEmbedHintTarget[] {
	const bounds = scrollEl.getBoundingClientRect();
	return Array.from(scrollEl.querySelectorAll<HTMLElement>('.markdown-embed'))
		.filter((root) => isTopLevelEmbed(root))
		.map((root): MarkdownEmbedHintTarget | null => {
			const control = embedControl(root);
			const linktext = root.getAttribute('src');
			if (!control || !linktext || !isVisible(root, bounds) || isNonMarkdownEmbed(root)) return null;
			if (!resolveMarkdownTarget(app, linktext, sourcePath)) return null;
			return { kind: 'internal', element: control, root, linktext, sourcePath };
		})
		.filter((target): target is MarkdownEmbedHintTarget => target !== null);
}

/** Collect ordinary links and resolved Markdown embed roots in document order. */
export function collectVisibleLinkHintTargets(
	scrollEl: HTMLElement,
	app: App,
	sourcePath: string,
	footnotes: FootnoteResolver,
): LinkHintTarget[] {
	const embeds = collectMarkdownEmbedTargets(scrollEl, app, sourcePath);
	const embedsByRoot = new Map<HTMLElement, MarkdownEmbedHintTarget>();
	embeds.forEach((target) => embedsByRoot.set(target.root, target));
	const bounds = scrollEl.getBoundingClientRect();
	const targets: LinkHintTarget[] = [];
	const candidates = scrollEl.querySelectorAll<HTMLElement>(
		'a.internal-link, a.external-link, a[href], ' + FOOTNOTE_REFERENCE_SELECTOR + ', .markdown-embed',
	);
	candidates.forEach((candidate) => {
		if (candidate.classList.contains('markdown-embed')) {
			const embed = embedsByRoot.get(candidate);
			if (embed) targets.push(embed);
			return;
		}
		if (candidate.closest('.markdown-embed')) return;
		const target = ordinaryLinkTarget(candidate as HTMLAnchorElement, sourcePath, bounds, footnotes);
		if (target) targets.push(target);
	});
	return targets;
}

export function hintTargetElement(target: LinkHintTarget): HTMLElement {
	return target.kind === 'internal' ? target.element : target.link;
}

export function createHintElement(
	label: string,
	target: LinkHintTarget,
	doc: Document,
	bounds: DOMRect,
): HTMLElement {
	const element = hintTargetElement(target);
	const anchor = target.kind === 'internal' && target.root
		? element.querySelector('svg') ?? element
		: element;
	const rect = anchor.getBoundingClientRect();
	let x = rect.left;
	let y = rect.top + rect.height / 2;
	if (target.kind === 'internal' && target.root) {
		const rootRect = target.root.getBoundingClientRect();
		const controlVisible = rect.width > 0 && rect.height > 0
			&& rect.bottom > bounds.top && rect.top < bounds.bottom
			&& rect.right > bounds.left && rect.left < bounds.right;
		if (!controlVisible) {
			const visibleTop = Math.max(rootRect.top, bounds.top);
			const visibleBottom = Math.min(rootRect.bottom, bounds.bottom);
			if (visibleBottom > visibleTop) y = visibleTop + Math.min(12, (visibleBottom - visibleTop) / 2);
			const visibleLeft = Math.max(rootRect.left, bounds.left);
			const visibleRight = Math.min(rootRect.right, bounds.right);
			x = visibleRight > visibleLeft
				? visibleLeft
				: Math.max(bounds.left, Math.min(rootRect.left, bounds.right));
		}
	}
	const el = doc.body.createSpan({ cls: 'vim-reading-nav-hint', text: label.toUpperCase() });
	el.style.left = `${x}px`;
	el.style.top = `${y}px`;
	return el;
}

function ordinaryLinkTarget(
	link: HTMLAnchorElement,
	sourcePath: string,
	bounds: DOMRect,
	footnotes: FootnoteResolver,
): LinkHintTarget | null {
	if (!isVisible(link, bounds)) return null;
	const footnote = footnotes.get(link);
	if (link.matches(FOOTNOTE_REFERENCE_SELECTOR)) {
		if (!footnote) return null;
		if (footnote.kind === 'standard') {
			return { kind: 'standardFootnote', link, sourcePath, id: footnote.id };
		}
		return { kind: 'inlineFootnote', link, markdown: footnote.markdown, sourcePath };
	}
	if (link.classList.contains('internal-link')) {
		const linktext = link.getAttribute('data-href') ?? link.getAttribute('href');
		return linktext ? { kind: 'internal', element: link, linktext, sourcePath } : null;
	}
	const url = parseHttpUrl(link.getAttribute('href'));
	return url ? { kind: 'external', link } : null;
}

function isTopLevelEmbed(root: HTMLElement): boolean {
	return root.parentElement?.closest('.markdown-embed') === null;
}

function embedControl(root: HTMLElement): HTMLElement | null {
	return Array.from(root.querySelectorAll<HTMLElement>('.markdown-embed-link'))
		.find((control) => control.closest('.markdown-embed') === root) ?? null;
}

function isNonMarkdownEmbed(root: HTMLElement): boolean {
	return root.matches('iframe, .iframe-embed, .pdf-embed, .image-embed, .audio-embed, .video-embed');
}

function isVisible(element: HTMLElement, bounds: DOMRect): boolean {
	const rect = element.getBoundingClientRect();
	return rect.width > 0 && rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom;
}
