import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

const result = await build({
	stdin: { contents: `
		export { CodeCopyHintHandler } from './src/codeCopyHintHandler';
		export { collectVisibleCodeBlocks, createCodeBlockHintElement } from './src/codeBlockTargets';
		export { collectVisibleInlineCode, createInlineCodeHintElement, inlineCodeText } from './src/inlineCodeTargets';
		export { HintModes } from './src/hintModes';
	`, resolveDir: process.cwd() },
	bundle: true, write: false, format: 'esm', platform: 'node',
	plugins: [{ name: 'obsidian-host', setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
		build.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: `
			export class MarkdownView { getMode() { return 'preview'; } }
		` }));
	} }],
});
const {
	CodeCopyHintHandler,
	collectVisibleCodeBlocks,
	createCodeBlockHintElement,
	collectVisibleInlineCode,
	createInlineCodeHintElement,
	inlineCodeText,
	HintModes,
} = await import(
	`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`,
);

function rect(left, top, width, height) {
	return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON() {} };
}

function setRect(element, value) {
	Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: () => value });
	return element;
}

/** Inline code wraps into several line boxes; linkedom has no layout. */
function setLineBoxes(element, boxes) {
	Object.defineProperty(element, 'getClientRects', { configurable: true, value: () => boxes });
	return setRect(element, boxes[0] ?? rect(0, 0, 0, 0));
}

function inlineCode(id, text = id) {
	return `<p><code id="${id}">${text}</code></p>`;
}

/** Record clipboard writes instead of touching the host clipboard. */
function stubClipboard() {
	const writes = [];
	Object.defineProperty(globalThis.navigator, 'clipboard', {
		configurable: true,
		value: { writeText: async (text) => { writes.push(text); } },
	});
	return writes;
}

/** Obsidian adds these helpers to HTMLElement; linkedom does not. */
function patchDocument(document) {
	const proto = document.defaultView.HTMLElement.prototype;
	proto.addClass ??= function (name) { this.classList.add(name); };
	proto.removeClass ??= function (name) { this.classList.remove(name); };
	proto.toggleClass ??= function (name, force) { this.classList.toggle(name, force); };
	proto.instanceOf ??= function (constructor) { return this instanceof constructor; };
	document.body.createSpan = ({ cls, text }) => {
		const span = document.createElement('span');
		span.className = cls;
		span.textContent = text;
		document.body.append(span);
		return span;
	};
	// Elements carry `data-clip` to stand in for a non-visible computed overflow.
	document.defaultView.getComputedStyle = (el) => {
		const overflow = el.getAttribute('data-clip') ?? 'visible';
		return { overflowX: overflow, overflowY: overflow };
	};
	return document;
}

/** Let a started copy finish: setImmediate runs after every pending promise callback. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

function codeBlock(id, text = id) {
	return `<pre id="${id}"><code>${text}</code><button class="copy-code-button"></button></pre>`;
}

function fixture(contents) {
	const { document } = parseHTML(`<html><body><div id="pane"><div class="markdown-reading-view"><div id="scroll" class="markdown-preview-view">${contents}</div></div></div></body></html>`);
	patchDocument(document);
	const scroll = setRect(document.querySelector('#scroll'), rect(0, 0, 600, 500));
	return { document, pane: document.querySelector('#pane'), scroll };
}

function handlerFixture(contents) {
	const dom = fixture(contents);
	const listeners = [];
	const view = { containerEl: dom.pane, getMode: () => 'preview' };
	const plugin = {
		app: { workspace: { on() { return {}; }, getActiveViewOfType: () => view } },
		registerDomEvent(_target, type, callback) { listeners.push({ type, callback }); },
		registerEvent() {},
		register() {},
	};
	const handler = new CodeCopyHintHandler(plugin, new HintModes());
	handler.register();
	handler.registerTo(dom.document);
	const press = (key, options = {}) => {
		const event = {
			key,
			ctrlKey: false, metaKey: false, altKey: false, repeat: false,
			...options,
			targetNode: options.targetNode ?? dom.document.body,
			consumed: false,
			preventDefault() { this.consumed = true; },
			stopImmediatePropagation() {},
		};
		const previous = globalThis.HTMLElement;
		globalThis.HTMLElement = dom.document.defaultView.HTMLElement;
		try {
			listeners.find((entry) => entry.type === 'keydown').callback(event);
		} finally {
			if (previous === undefined) delete globalThis.HTMLElement;
			else globalThis.HTMLElement = previous;
		}
		return event;
	};
	const scrollEvent = () => listeners.find((entry) => entry.type === 'scroll').callback();
	const hints = () => [...dom.document.querySelectorAll('.vim-reading-nav-code-hint')];
	const inlineHints = () => [...dom.document.querySelectorAll('.vim-reading-nav-inline-code-hint')];
	return { ...dom, handler, press, scrollEvent, hints, inlineHints };
}

function trackClicks(pre) {
	const clicks = [];
	pre.querySelector('button.copy-code-button').addEventListener('click', () => clicks.push(pre.id));
	return clicks;
}

test('collects visible code blocks with a native copy button in document order', () => {
	const dom = fixture(`
		${codeBlock('first')}
		<pre id="no-button"><code>mermaid source</code></pre>
		${codeBlock('hidden')}
		${codeBlock('below')}
		<div class="callout">${codeBlock('callout')}</div>
		<div class="markdown-embed"><div class="markdown-embed-content">${codeBlock('embedded')}</div></div>
	`);
	setRect(dom.scroll.querySelector('#first'), rect(10, 20, 500, 80));
	setRect(dom.scroll.querySelector('#no-button'), rect(10, 110, 500, 40));
	setRect(dom.scroll.querySelector('#hidden'), rect(0, 0, 0, 0));
	setRect(dom.scroll.querySelector('#below'), rect(10, 700, 500, 80));
	setRect(dom.scroll.querySelector('#callout'), rect(30, 200, 460, 60));
	setRect(dom.scroll.querySelector('#embedded'), rect(30, 300, 460, 60));
	const targets = collectVisibleCodeBlocks(dom.scroll);
	assert.deepEqual(targets.map((target) => target.pre.id), ['first', 'callout', 'embedded']);
	assert.ok(targets.every((target) => target.button === target.pre.querySelector('button.copy-code-button')));
});

test('ignores copy buttons that belong to a nested block rather than the pre itself', () => {
	const dom = fixture(`<pre id="outer"><code>outer</code><div>${codeBlock('inner')}</div></pre>`);
	setRect(dom.scroll.querySelector('#outer'), rect(10, 10, 500, 200));
	setRect(dom.scroll.querySelector('#inner'), rect(20, 40, 400, 60));
	assert.deepEqual(collectVisibleCodeBlocks(dom.scroll).map((target) => target.pre.id), ['inner']);
});

test('excludes blocks scrolled out of a clipping embed and clips partially visible ones', () => {
	const dom = fixture(`
		<div id="embed" class="markdown-embed-content" data-clip="auto">
			${codeBlock('inside')}${codeBlock('partial')}${codeBlock('clipped')}
		</div>
	`);
	setRect(dom.scroll.querySelector('#embed'), rect(20, 100, 400, 200));
	setRect(dom.scroll.querySelector('#inside'), rect(30, 120, 380, 60));
	setRect(dom.scroll.querySelector('#partial'), rect(30, 260, 380, 100));
	setRect(dom.scroll.querySelector('#clipped'), rect(30, 400, 380, 60));
	const targets = collectVisibleCodeBlocks(dom.scroll);
	assert.deepEqual(targets.map((target) => target.pre.id), ['inside', 'partial']);
	assert.deepEqual(targets[1].visible, { left: 30, top: 260, right: 410, bottom: 300 });
});

test('places the hint at the top-right of the visible part of a long block', () => {
	const dom = fixture(codeBlock('long'));
	setRect(dom.scroll, rect(0, 100, 600, 500));
	setRect(dom.scroll.querySelector('#long'), rect(40, -300, 520, 2000));
	const [target] = collectVisibleCodeBlocks(dom.scroll);
	const hint = createCodeBlockHintElement('a', target, dom.document);
	assert.equal(hint.textContent, 'A');
	assert.equal(Number.parseFloat(hint.style.left), 554);
	assert.equal(Number.parseFloat(hint.style.top), 118);
	const short = fixture(codeBlock('short'));
	setRect(short.scroll.querySelector('#short'), rect(40, 100, 520, 20));
	const shortHint = createCodeBlockHintElement('a', collectVisibleCodeBlocks(short.scroll)[0], short.document);
	assert.equal(Number.parseFloat(shortHint.style.top), 110);
});

test('y shows hints and a label clicks only the chosen native copy button', async () => {
	const dom = handlerFixture(codeBlock('one') + codeBlock('two'));
	setRect(dom.scroll.querySelector('#one'), rect(10, 10, 500, 80));
	setRect(dom.scroll.querySelector('#two'), rect(10, 120, 500, 80));
	const oneClicks = trackClicks(dom.scroll.querySelector('#one'));
	const twoClicks = trackClicks(dom.scroll.querySelector('#two'));
	assert.equal(dom.press('y').consumed, true);
	assert.deepEqual(dom.hints().map((hint) => hint.textContent), ['A', 'S']);
	assert.equal(dom.handler.isActive(dom.document), true);
	dom.press('s');
	assert.deepEqual(twoClicks, ['two']);
	assert.deepEqual(oneClicks, []);
	assert.equal(dom.hints().length, 0);
	assert.equal(dom.handler.isActive(dom.document), false);
	await settle();
	assert.ok(dom.scroll.querySelector('#two').classList.contains('vim-reading-nav-copied'));
});

test('copied outline clears after the native feedback window and on cleanup', async (t) => {
	const dom = handlerFixture(codeBlock('one') + codeBlock('two'));
	const timers = [];
	// linkedom windows share the real global timers; stub them for this test only.
	const win = dom.document.defaultView;
	const { setTimeout: realSetTimeout, clearTimeout: realClearTimeout } = win;
	t.after(() => { win.setTimeout = realSetTimeout; win.clearTimeout = realClearTimeout; });
	win.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
	win.clearTimeout = () => {};
	setRect(dom.scroll.querySelector('#one'), rect(10, 10, 500, 80));
	setRect(dom.scroll.querySelector('#two'), rect(10, 120, 500, 80));
	const one = dom.scroll.querySelector('#one');
	const two = dom.scroll.querySelector('#two');
	dom.press('y');
	dom.press('a');
	await settle();
	assert.ok(one.classList.contains('vim-reading-nav-copied'));
	assert.equal(timers[0].ms, 300);
	dom.press('y');
	dom.press('s');
	await settle();
	assert.equal(one.classList.contains('vim-reading-nav-copied'), false);
	assert.ok(two.classList.contains('vim-reading-nav-copied'));
	timers[0].fn();
	assert.ok(two.classList.contains('vim-reading-nav-copied'), 'a stale timer must not clear the newer outline');
	timers[1].fn();
	assert.equal(two.classList.contains('vim-reading-nav-copied'), false);
	dom.press('y');
	dom.press('a');
	await settle();
	dom.handler.cleanup();
	assert.equal(one.classList.contains('vim-reading-nav-copied'), false);
});

test('two-character labels, backspace and mismatches behave like other hint modes', () => {
	const ids = Array.from({ length: 27 }, (_, index) => `b${index}`);
	const dom = handlerFixture(ids.map((id) => codeBlock(id)).join(''));
	ids.forEach((id, index) => setRect(dom.scroll.querySelector(`#${id}`), rect(10, index * 10, 500, 8)));
	const last = trackClicks(dom.scroll.querySelector('#b26'));
	const first = trackClicks(dom.scroll.querySelector('#b0'));
	dom.press('y');
	assert.deepEqual(dom.hints().slice(0, 2).map((hint) => hint.textContent), ['AA', 'AS']);
	// 24 labels start with a: aa, as, ad, ... ; the 25th to 27th start with s.
	dom.press('s');
	assert.ok(dom.hints().slice(0, 24).every((hint) => hint.classList.contains('vim-reading-nav-hint-inactive')));
	assert.deepEqual(dom.hints().slice(24).map((hint) => hint.textContent), ['SA', 'SS', 'SD']);
	assert.ok(dom.hints().slice(24).every((hint) => !hint.classList.contains('vim-reading-nav-hint-inactive')));
	dom.press('Backspace');
	assert.equal(dom.hints()[0].classList.contains('vim-reading-nav-hint-inactive'), false);
	dom.press('s');
	dom.press('d');
	assert.deepEqual(last, ['b26']);
	dom.press('y');
	dom.press('z');
	dom.press('z');
	assert.equal(dom.handler.isActive(dom.document), false);
	assert.deepEqual(first, []);
});

test('Escape, non-label keys, modifiers and scrolling cancel without copying', () => {
	const dom = handlerFixture(codeBlock('one'));
	setRect(dom.scroll.querySelector('#one'), rect(10, 10, 500, 80));
	const clicks = trackClicks(dom.scroll.querySelector('#one'));
	for (const cancel of [
		() => dom.press('Escape'),
		() => dom.press('1'),
		() => dom.press('A'),
		() => dom.press('a', { ctrlKey: true }),
		() => dom.scrollEvent(),
	]) {
		dom.press('y');
		assert.equal(dom.hints().length, 1);
		cancel();
		assert.equal(dom.hints().length, 0);
		assert.equal(dom.handler.isActive(dom.document), false);
	}
	assert.deepEqual(clicks, []);
});

test('a second y closes code block hints, while a held y keeps them', () => {
	const ids = Array.from({ length: 20 }, (_, index) => `r${index}`);
	const dom = handlerFixture(ids.map((id) => codeBlock(id)).join(''));
	ids.forEach((id, index) => setRect(dom.scroll.querySelector(`#${id}`), rect(10, index * 20, 500, 18)));
	const clicks = ids.flatMap((id) => trackClicks(dom.scroll.querySelector(`#${id}`)));
	dom.press('y');
	assert.equal(dom.hints().length, 20);
	assert.ok(dom.hints().every((hint) => hint.textContent !== 'Y' && hint.textContent !== 'F'));
	assert.equal(dom.press('y', { repeat: true }).consumed, true);
	assert.equal(dom.handler.isActive(dom.document), true);
	assert.equal(dom.press('y').consumed, true);
	assert.equal(dom.handler.isActive(dom.document), false);
	assert.equal(dom.hints().length, 0);
	assert.deepEqual(clicks, []);
});

test('y is ignored without visible blocks, with modifiers, and in inputs', () => {
	const empty = handlerFixture('<p>No code</p>');
	empty.press('y');
	assert.equal(empty.handler.isActive(empty.document), false);
	assert.equal(empty.hints().length, 0);

	const dom = handlerFixture(codeBlock('one'));
	setRect(dom.scroll.querySelector('#one'), rect(10, 10, 500, 80));
	assert.equal(dom.press('y', { metaKey: true }).consumed, false);
	const input = dom.document.createElement('input');
	dom.document.body.append(input);
	assert.equal(dom.press('y', { targetNode: input }).consumed, false);
	assert.equal(dom.handler.isActive(dom.document), false);
	assert.equal(dom.press('y').consumed, true);
	assert.equal(dom.handler.isActive(dom.document), true);
});

test('a block re-rendered after hints appear is not copied', () => {
	const dom = handlerFixture(codeBlock('one') + codeBlock('two'));
	setRect(dom.scroll.querySelector('#one'), rect(10, 10, 500, 80));
	setRect(dom.scroll.querySelector('#two'), rect(10, 120, 500, 80));
	const clicks = trackClicks(dom.scroll.querySelector('#one'));
	dom.press('y');
	dom.scroll.querySelector('#one').remove();
	dom.press('a');
	assert.deepEqual(clicks, []);
	assert.equal(dom.hints().length, 0);
});

test('collects visible inline code outside code blocks and anchors wrapped spans on a visible line', () => {
	const dom = fixture(`
		${inlineCode('first', 'npm run build')}
		<pre id="block"><code id="in-pre">block code</code><button class="copy-code-button"></button></pre>
		${inlineCode('empty', '')}
		${inlineCode('below', 'offscreen')}
		${inlineCode('wrapped', 'spark-submit app.jar --class Main')}
		<div class="markdown-embed-content" data-clip="auto">${inlineCode('clipped', 'hidden by embed')}</div>
	`);
	setLineBoxes(dom.scroll.querySelector('#first'), [rect(20, 20, 90, 18)]);
	setLineBoxes(dom.scroll.querySelector('#in-pre'), [rect(20, 60, 90, 18)]);
	setLineBoxes(dom.scroll.querySelector('#empty'), [rect(20, 100, 10, 18)]);
	setLineBoxes(dom.scroll.querySelector('#below'), [rect(20, 900, 90, 18)]);
	// Wrapped: first line box ends above the viewport, the second is visible.
	setLineBoxes(dom.scroll.querySelector('#wrapped'), [rect(400, -30, 180, 18), rect(10, -8, 120, 18)]);
	setRect(dom.scroll.querySelector('[data-clip]'), rect(10, 200, 500, 40));
	setLineBoxes(dom.scroll.querySelector('#clipped'), [rect(20, 300, 90, 18)]);
	const targets = collectVisibleInlineCode(dom.scroll);
	assert.deepEqual(targets.map((target) => target.code.id), ['first', 'wrapped']);
	assert.deepEqual(targets.map((target) => target.text), ['npm run build', 'spark-submit app.jar --class Main']);
	assert.deepEqual(targets[1].visible, { left: 10, top: 0, right: 130, bottom: 10 });
	const hint = createInlineCodeHintElement('a', targets[0], dom.document);
	assert.equal(hint.textContent, 'A');
	assert.ok(hint.classList.contains('vim-reading-nav-inline-code-hint'));
	assert.equal(Number.parseFloat(hint.style.left), 20, 'anchored on the left edge');
	assert.equal(Number.parseFloat(hint.style.top), 20, 'anchored on the top edge, not over the code');
	const wrapped = createInlineCodeHintElement('s', targets[1], dom.document);
	assert.equal(Number.parseFloat(wrapped.style.left), 10, 'a wrapped span anchors on its first visible line');
	assert.equal(Number.parseFloat(wrapped.style.top), 0);
});

test('inline code text drops Code Styler titles, icons and its zero-width space', () => {
	const { document } = parseHTML(`<html><body>
		<code id="plain">a  b\tc</code>
		<code id="styled" class="code-styler-inline"><span class="code-styler-inline-opener"><span class="code-styler-inline-title">Title</span></span><span class="token">print</span>(x)\n&ZeroWidthSpace;</code>
		<code id="braces">{**self.kwargs, **kwargs}</code>
		<code id="inner-newline">a\nb</code>
	</body></html>`);
	assert.equal(inlineCodeText(document.querySelector('#plain')), 'a  b\tc');
	assert.equal(inlineCodeText(document.querySelector('#styled')), 'print(x)');
	assert.equal(document.querySelector('#styled').textContent.includes('Title'), true, 'the rendered DOM is left untouched');
	assert.equal(inlineCodeText(document.querySelector('#braces')), '{**self.kwargs, **kwargs}');
	assert.equal(inlineCodeText(document.querySelector('#inner-newline')), 'a\nb', 'only a trailing line break is dropped');
});

test('Y copies the chosen inline code text and outlines it after the write succeeds', async () => {
	const writes = stubClipboard();
	const dom = handlerFixture(inlineCode('one', 'git status') + inlineCode('two', 'npm test') + codeBlock('block'));
	setLineBoxes(dom.scroll.querySelector('#one'), [rect(20, 20, 80, 18)]);
	setLineBoxes(dom.scroll.querySelector('#two'), [rect(20, 60, 80, 18)]);
	setRect(dom.scroll.querySelector('#block'), rect(10, 120, 500, 80));
	const blockClicks = trackClicks(dom.scroll.querySelector('#block'));
	assert.equal(dom.press('Y').consumed, true);
	assert.deepEqual(dom.inlineHints().map((hint) => hint.textContent), ['A', 'S']);
	assert.equal(dom.hints().length, 0, 'Y shows inline hints only');
	dom.press('s');
	assert.deepEqual(writes, ['npm test']);
	assert.equal(dom.inlineHints().length, 0);
	assert.equal(dom.handler.isActive(dom.document), false);
	assert.deepEqual(blockClicks, []);
	assert.equal(dom.scroll.querySelector('#two').classList.contains('vim-reading-nav-copied'), false, 'outline waits for the write');
	await settle();
	assert.ok(dom.scroll.querySelector('#two').classList.contains('vim-reading-nav-copied'));
	dom.handler.cleanup();
});

test('a copy that finishes after unload outlines nothing', async () => {
	stubClipboard();
	const dom = handlerFixture(inlineCode('one', 'git status'));
	setLineBoxes(dom.scroll.querySelector('#one'), [rect(20, 20, 80, 18)]);
	dom.press('Y');
	dom.press('a');
	dom.handler.cleanup();
	await settle();
	assert.equal(dom.scroll.querySelector('#one').classList.contains('vim-reading-nav-copied'), false);
});

test('a failed inline copy shows no outline', async () => {
	Object.defineProperty(globalThis.navigator, 'clipboard', {
		configurable: true,
		value: { writeText: async () => { throw new Error('denied'); } },
	});
	const errors = [];
	const original = console.error;
	console.error = (...args) => errors.push(args);
	try {
		const dom = handlerFixture(inlineCode('one', 'git status'));
		setLineBoxes(dom.scroll.querySelector('#one'), [rect(20, 20, 80, 18)]);
		dom.press('Y');
		dom.press('a');
		await settle();
		assert.equal(dom.scroll.querySelector('#one').classList.contains('vim-reading-nav-copied'), false);
		assert.equal(errors.length, 1);
	} finally {
		console.error = original;
	}
});

test('a second Y closes inline hints; y and Y close each other without opening', () => {
	const writes = stubClipboard();
	const dom = handlerFixture(inlineCode('one') + codeBlock('block'));
	setLineBoxes(dom.scroll.querySelector('#one'), [rect(20, 20, 80, 18)]);
	setRect(dom.scroll.querySelector('#block'), rect(10, 120, 500, 80));
	const blockClicks = trackClicks(dom.scroll.querySelector('#block'));
	dom.press('Y');
	assert.equal(dom.press('Y', { repeat: true }).consumed, true);
	assert.equal(dom.handler.isActive(dom.document), true);
	dom.press('Y');
	assert.equal(dom.handler.isActive(dom.document), false);
	assert.equal(dom.inlineHints().length, 0);
	// y is never a label: inside Y hints it only closes them, and opens nothing.
	dom.press('Y');
	assert.equal(dom.press('y').consumed, true);
	assert.equal(dom.handler.isActive(dom.document), false);
	assert.equal(dom.hints().length, 0);
	assert.equal(dom.inlineHints().length, 0);
	dom.press('y');
	assert.equal(dom.press('Y').consumed, true);
	assert.equal(dom.handler.isActive(dom.document), false);
	assert.equal(dom.hints().length, 0);
	assert.deepEqual(writes, []);
	assert.deepEqual(blockClicks, []);
});

test('Y is ignored with modifiers and without inline code', () => {
	stubClipboard();
	const dom = handlerFixture(inlineCode('one'));
	setLineBoxes(dom.scroll.querySelector('#one'), [rect(20, 20, 80, 18)]);
	assert.equal(dom.press('Y', { ctrlKey: true }).consumed, false);
	const empty = handlerFixture('<p>No code</p>');
	empty.press('Y');
	assert.equal(empty.handler.isActive(empty.document), false);
});
