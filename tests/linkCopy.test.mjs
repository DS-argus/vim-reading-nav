import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

// The real FootnoteResolver over a mocked vault, so footnote bodies are read
// from source the way the preview reads them.
const result = await build({
	stdin: { contents: `
		export { linkCopyText, readableUrl } from './src/linkCopyText';
		export { FootnoteResolver } from './src/footnoteResolver';
		export { TFile } from 'obsidian';
	`, resolveDir: process.cwd() },
	bundle: true, write: false, format: 'esm', platform: 'node',
	plugins: [{ name: 'obsidian-host', setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
		build.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: `
			export class TFile { constructor(path) { this.path = path; } }
		` }));
	} }],
});
const { linkCopyText, readableUrl, FootnoteResolver, TFile } = await import(
	`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`,
);

const SOURCE = [
	'본문[^one] 그리고[^multi]',
	'',
	'[^one]: 한 줄 **굵게** [[노트#제목|별칭]]',
	'[^multi]: 첫 줄',
	'\t둘째 줄 `code`',
	'  셋째 줄',
	'',
].join('\n');

function footnotes() {
	const file = new TFile('source.md');
	// Obsidian's footnote spans end at the last character of the definition.
	const span = (id, text) => {
		const start = SOURCE.indexOf(`[^${id}]:`);
		return { id, position: { start: { offset: start }, end: { offset: SOURCE.indexOf(text, start) + text.length } } };
	};
	return new FootnoteResolver({
		vault: {
			getAbstractFileByPath: (path) => path === 'source.md' ? file : null,
			cachedRead: async () => SOURCE,
		},
		metadataCache: { getFileCache: () => ({ footnotes: [span('one', '별칭]]'), span('multi', '셋째 줄')] }) },
	});
}

const link = (href) => ({ getAttribute: (name) => name === 'href' ? href : null });

test('internal links and embeds copy their target without display text', async () => {
	for (const linktext of ['노트#제목', '#제목', '노트#^abc', '폴더/노트', 'log/a.md', 'B23-대상#짧은 대상']) {
		assert.equal(await linkCopyText({ kind: 'internal', linktext }, footnotes()), linktext);
	}
});

test('external links copy the URL as written, with non-ASCII characters readable', async () => {
	const copy = (href) => linkCopyText({ kind: 'external', link: link(href), url: new URL(href) }, footnotes());
	assert.equal(await copy('https://github.com/a/b'), 'https://github.com/a/b');
	assert.equal(await copy('https://ko.wikipedia.org/wiki/%ED%95%9C%EA%B5%AD%EC%96%B4'), 'https://ko.wikipedia.org/wiki/한국어');
	assert.equal(await copy('https://help.obsidian.md'), 'https://help.obsidian.md', 'no trailing slash is added');
});

test('readableUrl decodes only non-ASCII escapes', () => {
	assert.equal(readableUrl('https://x.test/%ED%95%9C?q=a%20b&p=%2Fc'), 'https://x.test/한?q=a%20b&p=%2Fc');
	assert.equal(readableUrl('https://x.test/%ED%95'), 'https://x.test/%ED%95', 'a broken sequence stays encoded');
	assert.equal(readableUrl('https://x.test/plain'), 'https://x.test/plain');
});

test('footnotes copy the Markdown body of their definition', async () => {
	assert.equal(await linkCopyText({ kind: 'inlineFootnote', markdown: '**굵게** [[노트]]' }, footnotes()), '**굵게** [[노트]]');
	assert.equal(
		await linkCopyText({ kind: 'standardFootnote', sourcePath: 'source.md', id: 'one' }, footnotes()),
		'한 줄 **굵게** [[노트#제목|별칭]]',
	);
	assert.equal(
		await linkCopyText({ kind: 'standardFootnote', sourcePath: 'source.md', id: 'multi' }, footnotes()),
		'첫 줄\n둘째 줄 `code`\n셋째 줄',
		'the definition marker and continuation indents are removed',
	);
	assert.equal(await linkCopyText({ kind: 'standardFootnote', sourcePath: 'source.md', id: 'missing' }, footnotes()), null);
});
