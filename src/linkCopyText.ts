import type { FootnoteResolver } from './footnoteResolver';
import type { FocusedTarget } from './linkPreviewSession';

/**
 * What `y` copies from a focused link, as written in Markdown:
 * - an internal link or embed: its target, such as `Note#Heading`, without display text;
 * - an external link: its URL;
 * - a footnote: the Markdown body of its definition.
 */
export async function linkCopyText(focused: FocusedTarget, footnotes: FootnoteResolver): Promise<string | null> {
	if (focused.kind === 'internal') return focused.linktext;
	if (focused.kind === 'inlineFootnote') return focused.markdown;
	if (focused.kind === 'standardFootnote') return footnotes.definitionMarkdown(focused.sourcePath, focused.id);
	return readableUrl(focused.link.getAttribute('href') ?? focused.url.href);
}

/**
 * Rendered links percent-encode non-ASCII characters, so `wiki/한국어` arrives
 * as `wiki/%ED%95%9C...`. Decode those back as they were written, but keep
 * ASCII escapes such as `%20` or `%2F`, which change the URL when decoded.
 */
export function readableUrl(href: string): string {
	return href.replace(/(?:%[89a-f][0-9a-f])+/gi, (encoded) => {
		try {
			return decodeURIComponent(encoded);
		} catch {
			return encoded;
		}
	});
}
