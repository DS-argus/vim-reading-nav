import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

// The real FootnoteResolver, driven through the post-processor it registers.
const result = await build({
	stdin: { contents: `export { FootnoteResolver } from './src/footnoteResolver'; export { TFile } from 'obsidian';`, resolveDir: process.cwd() },
	bundle: true, write: false, format: 'esm', platform: 'node',
	plugins: [{ name: 'obsidian-host', setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
		build.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: `
			export class App {}
			export class TFile { constructor(path) { this.path = path; } }
		` }));
	} }],
});
const { FootnoteResolver, TFile } = await import(
	`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`,
);

const SOURCE = [
	'본문[^one] 그리고 인라인^[짧은 설명]',
	'',
	'[^one]: 정의',
	'',
].join('\n');

/** A resolver over one note, and the post-processor Obsidian would call for each rendered section. */
function setup() {
	const file = new TFile('source.md');
	const at = (text) => {
		const start = SOURCE.indexOf(text);
		return { start: { offset: start }, end: { offset: start + text.length } };
	};
	const app = {
		vault: {
			getAbstractFileByPath: (path) => path === 'source.md' ? file : null,
			cachedRead: async () => SOURCE,
		},
		metadataCache: {
			getFileCache: () => ({
				footnoteRefs: [{ id: 'one', position: at('[^one]') }],
				footnotes: [{ id: 'one', position: at('[^one]: 정의') }, { id: 'inline', position: at('^[짧은 설명]') }],
				sections: [],
			}),
		},
	};
	let postProcess = null;
	const resolver = new FootnoteResolver(app);
	resolver.register({ registerMarkdownPostProcessor: (fn) => { postProcess = fn; } });
	return { resolver, file, postProcess };
}

function renderedSection() {
	const { document } = parseHTML(`<html><body><div id="host"></div></body></html>`);
	const section = document.createElement('div');
	section.innerHTML = '<p>본문<sup class="footnote-ref"><a class="footnote-link" href="#fn-1">[1]</a></sup> 그리고 인라인<sup class="footnote-ref"><a class="footnote-link" href="#fn-2">[2]</a></sup></p>';
	return { document, section, anchors: [...section.querySelectorAll('a')] };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const context = { sourcePath: 'source.md', getSectionInfo: () => ({ lineStart: 0, lineEnd: 0, text: SOURCE }) };

test('a section rendered before it is mounted still gets its footnotes', async () => {
	// Long notes render sections ahead of mounting them and post-process them only once.
	const { resolver, postProcess } = setup();
	const { document, section, anchors } = renderedSection();
	assert.equal(section.isConnected, false);
	await postProcess(section, context);
	await flush();
	document.querySelector('#host').append(section);
	assert.deepEqual(resolver.get(anchors[0]), { kind: 'standard', id: 'one' });
	assert.deepEqual(resolver.get(anchors[1]), { kind: 'inline', markdown: '짧은 설명' });
});

test('a section re-processed while the source is read keeps only the latest result', async () => {
	const { resolver, postProcess } = setup();
	const { section, anchors } = renderedSection();
	const stale = postProcess(section, context);
	// Re-rendering replaces the anchors before the first read finishes.
	section.innerHTML = '<p>본문</p>';
	await stale;
	await flush();
	assert.equal(resolver.get(anchors[0]), undefined, 'anchors moved out of the section are not associated');
});
