export interface InlineFootnoteReference {
	startOffset: number;
	endOffset: number;
	markdown: string;
}

/** Finds inline footnotes wholly contained in the supplied source offset window. */
export function scanInlineFootnoteReferences(
	source: string,
	windowStart: number,
	windowEnd: number,
): InlineFootnoteReference[] {
	const references: InlineFootnoteReference[] = [];
	const start = Math.max(0, windowStart);
	const end = Math.min(source.length, Math.max(start, windowEnd));
	let inFrontmatter = isFrontmatter(source);
	let fence: { character: string; length: number } | null = null;
	let htmlBlock: string | null = null;

	for (let offset = 0; offset < source.length;) {
		const lineEnd = source.indexOf('\n', offset);
		const nextLine = lineEnd === -1 ? source.length : lineEnd + 1;
		const line = source.slice(offset, lineEnd === -1 ? source.length : lineEnd);
		if (inFrontmatter) {
			if (/^(---|\.\.\.)\s*$/.test(line) && offset !== 0) inFrontmatter = false;
			offset = nextLine;
			continue;
		}

		if (fence) {
			if (isFenceClose(line, fence)) fence = null;
			offset = nextLine;
			continue;
		}
		const openedFence = fenceOpen(line);
		if (openedFence) {
			fence = openedFence;
			offset = nextLine;
			continue;
		}

		if (htmlBlock) {
			if (new RegExp(`</${htmlBlock}\\s*>`, 'i').test(line)) htmlBlock = null;
			offset = nextLine;
			continue;
		}
		const openedHtmlBlock = /<\s*(script|style|pre|code)(?:\s|>|\/)/i.exec(line)?.[1];
		if (openedHtmlBlock) {
			htmlBlock = openedHtmlBlock.toLowerCase();
			offset = nextLine;
			continue;
		}
		if (/^\s*<!--/.test(line)) {
			const commentEnd = source.indexOf('-->', offset + 4);
			if (commentEnd === -1) return references;
			const followingLine = source.indexOf('\n', commentEnd + 3);
			offset = followingLine === -1 ? source.length : followingLine + 1;
			continue;
		}

		scanLine(source, offset, line.length, start, end, references);
		offset = nextLine;
	}
	return references;
}

function scanLine(source: string, lineStart: number, lineLength: number, windowStart: number, windowEnd: number, references: InlineFootnoteReference[]): void {
	const lineEnd = lineStart + lineLength;
	for (let offset = lineStart; offset < lineEnd; offset += 1) {
		if (source[offset] === '`') {
			const ticks = countRun(source, offset, '`', lineEnd);
			const close = source.indexOf('`'.repeat(ticks), offset + ticks);
			if (close === -1 || close >= lineEnd) return;
			offset = close + ticks - 1;
			continue;
		}
		if (source[offset] !== '^' || source[offset + 1] !== '[' || isEscaped(source, offset)) continue;
		const close = inlineFootnoteClose(source, offset + 2, lineEnd);
		if (close === null) continue;
		const endOffset = close + 1;
		if (offset >= windowStart && endOffset <= windowEnd) {
			references.push({ startOffset: offset, endOffset, markdown: source.slice(offset + 2, close) });
		}
		offset = close;
	}
}

function inlineFootnoteClose(source: string, offset: number, lineEnd: number): number | null {
	let depth = 1;
	for (let cursor = offset; cursor < lineEnd; cursor += 1) {
		if (source[cursor] === '\\') {
			cursor += 1;
			continue;
		}
		if (source[cursor] === '[') depth += 1;
		if (source[cursor] === ']' && --depth === 0) return cursor;
	}
	return null;
}

function isEscaped(source: string, offset: number): boolean {
	let backslashes = 0;
	for (let cursor = offset - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) backslashes += 1;
	return backslashes % 2 === 1;
}

function countRun(source: string, offset: number, character: string, end: number): number {
	let length = 0;
	while (offset + length < end && source[offset + length] === character) length += 1;
	return length;
}

function isFrontmatter(source: string): boolean {
	const firstLineEnd = source.indexOf('\n');
	return source.slice(0, firstLineEnd === -1 ? source.length : firstLineEnd).replace(/\r$/, '') === '---';
}

function fenceOpen(line: string): { character: string; length: number } | null {
	const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
	return match ? { character: match[1]![0]!, length: match[1]!.length } : null;
}

function isFenceClose(line: string, fence: { character: string; length: number }): boolean {
	return new RegExp(`^ {0,3}${fence.character}{${fence.length},}\\s*$`).test(line);
}
