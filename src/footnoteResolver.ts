import { App, TFile } from 'obsidian';
import type { Plugin } from 'obsidian';
import { scanInlineFootnoteReferences } from './inlineFootnoteScanner';

const FOOTNOTE_REFERENCE_SELECTOR = 'a.footnote-link, sup.footnote-ref > a';
const EXCLUDED_SECTION_TYPES = new Set(['code', 'html', 'yaml']);

type SectionInfo = { lineStart: number; lineEnd: number } | null;

export type FootnoteReference =
	| { kind: 'standard'; id: string }
	| { kind: 'inline'; markdown: string };

/** Returns the authored Markdown body from a footnote definition source range. */
export function footnoteDefinitionBodyMarkdown(definitionSource: string): string {
	return definitionSource
		.replace(/^\[\^[^\]\r\n]+\]:[ \t]?/, '')
		.replace(/(^|\r?\n)(?:\t| {2})/g, '$1');
}

/** Associates rendered footnote references with source metadata. */
export class FootnoteResolver {
	private readonly references = new WeakMap<HTMLAnchorElement, FootnoteReference>();
	private readonly associationGenerations = new WeakMap<HTMLElement, number>();

	constructor(private readonly app: App) {}

	register(plugin: Plugin): void {
		plugin.registerMarkdownPostProcessor((element, context) =>
			this.associate(element, context.sourcePath, context.getSectionInfo(element)));
	}

	get(anchor: HTMLAnchorElement): FootnoteReference | undefined {
		return this.references.get(anchor);
	}

	async definitionMarkdown(sourcePath: string, id: string): Promise<string | null> {
		const file = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(file instanceof TFile)) return null;

		const definition = this.app.metadataCache.getFileCache(file)?.footnotes
			?.find((footnote) => footnote.id === id);
		if (!definition) return null;

		const source = await this.app.vault.cachedRead(file);
		const definitionSource = source.slice(definition.position.start.offset, definition.position.end.offset);
		return footnoteDefinitionBodyMarkdown(definitionSource);
	}

	private async associate(element: HTMLElement, sourcePath: string, section: SectionInfo): Promise<void> {
		const generation = this.nextAssociationGeneration(element);
		try {
			if (!section) return;
			const file = this.app.vault.getAbstractFileByPath(sourcePath);
			if (!(file instanceof TFile)) return;

			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) return;
			const anchors = Array.from(element.querySelectorAll<HTMLAnchorElement>(FOOTNOTE_REFERENCE_SELECTOR));
			if (anchors.length === 0) return;

			const source = await this.app.vault.cachedRead(file);
			if (!this.isCurrentAssociation(element, generation, anchors)) return;
			const window = sectionSourceWindow(source, section);
			if (!window) return;

			const candidates = new Map<string, { offset: number; reference: FootnoteReference }>();
			const addCandidate = (startOffset: number, endOffset: number, reference: FootnoteReference): void => {
				candidates.set(`${startOffset}:${endOffset}`, { offset: startOffset, reference });
			};
			const isInWindow = (startOffset: number, endOffset: number): boolean =>
				startOffset >= window.start && endOffset <= window.end;

			for (const ref of cache.footnoteRefs ?? []) {
				const { start, end } = ref.position;
				if (!isInWindow(start.offset, end.offset)) continue;
				const reference = this.parseReference(source.slice(start.offset, end.offset));
				if (reference) addCandidate(start.offset, end.offset, reference);
			}
			for (const footnote of cache.footnotes ?? []) {
				const { start, end } = footnote.position;
				if (!isInWindow(start.offset, end.offset)) continue;
				const reference = this.parseReference(source.slice(start.offset, end.offset));
				if (reference?.kind === 'inline') addCandidate(start.offset, end.offset, reference);
			}

			const excludedRanges = (cache.sections ?? [])
				.filter((entry) => EXCLUDED_SECTION_TYPES.has(entry.type))
				.map((entry) => entry.position);
			for (const inline of scanInlineFootnoteReferences(source, window.start, window.end)) {
				const isExcluded = excludedRanges.some((range) =>
					inline.startOffset < range.end.offset && inline.endOffset > range.start.offset,
				);
				if (!isExcluded) {
					addCandidate(inline.startOffset, inline.endOffset, { kind: 'inline', markdown: inline.markdown });
				}
			}

			const references = [...candidates.values()]
				.sort((left, right) => left.offset - right.offset)
				.map((candidate) => candidate.reference);
			if (references.length !== anchors.length) return;
			anchors.forEach((anchor, index) => {
				const reference = references[index];
				if (reference) this.references.set(anchor, reference);
			});
		} catch (error) {
			console.error('Vim Reading Navigation: failed to associate footnotes', error);
		}
	}

	private nextAssociationGeneration(element: HTMLElement): number {
		const generation = (this.associationGenerations.get(element) ?? 0) + 1;
		this.associationGenerations.set(element, generation);
		return generation;
	}

	private isCurrentAssociation(element: HTMLElement, generation: number, anchors: HTMLAnchorElement[]): boolean {
		return element.isConnected
			&& this.associationGenerations.get(element) === generation
			&& anchors.every((anchor) => anchor.isConnected && element.contains(anchor));
	}

	private parseReference(source: string): FootnoteReference | null {
		const standard = /^\[\^([^\]\r\n]+)\]$/.exec(source);
		const standardId = standard?.[1];
		if (standardId) return { kind: 'standard', id: standardId };

		const inline = /^\^\[([\s\S]*)\]$/.exec(source);
		const inlineMarkdown = inline?.[1];
		return inlineMarkdown === undefined ? null : { kind: 'inline', markdown: inlineMarkdown };
	}
}

function sectionSourceWindow(source: string, section: NonNullable<SectionInfo>): { start: number; end: number } | null {
	const lineOffsets = [0];
	for (let offset = source.indexOf('\n'); offset !== -1; offset = source.indexOf('\n', offset + 1)) {
		lineOffsets.push(offset + 1);
	}
	const start = lineOffsets[section.lineStart];
	if (start === undefined) return null;
	return { start, end: lineOffsets[section.lineEnd + 1] ?? source.length };
}
