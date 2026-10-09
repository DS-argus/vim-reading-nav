import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const result = await build({
	entryPoints: ['src/previewPlacement.ts'],
	bundle: true, write: false, format: 'esm', platform: 'node',
});
const { placePreview } = await import(
	`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`,
);

const VIEW_W = 1200;
const VIEW_H = 900;
const target = (top, left = 100, height = 20) => ({ left, top, bottom: top + height });
const place = (t, width, height, viewW = VIEW_W, viewH = VIEW_H) => placePreview(t, width, height, viewW, viewH);

test('a preview that fits below the link opens below it', () => {
	assert.deepEqual(place(target(100), 576, 300), { side: 'below', left: 100, inset: 128, room: 760 });
});

test('a link near the bottom gets its preview above, growing upward from the link', () => {
	// The link spans 800-820; the preview's bottom edge sits 8px above the link.
	assert.deepEqual(place(target(800), 576, 400), { side: 'above', left: 100, inset: 108, room: 780 });
});

test('a preview too tall for either side takes the roomier side and is capped to it', () => {
	assert.deepEqual(place(target(300), 576, 800), { side: 'below', left: 100, inset: 328, room: 560 });
	assert.deepEqual(place(target(580), 576, 800), { side: 'above', left: 100, inset: 328, room: 560 });
});

test('below wins when the preview fits on both sides', () => {
	assert.equal(place(target(400), 576, 100).side, 'below');
});

test('the preview never covers the focused link and stays inside the viewport', () => {
	for (let top = -40; top <= VIEW_H + 40; top += 7) {
		for (const height of [40, 200, 450, 570, 900]) {
			const t = target(top);
			const p = place(t, 576, height);
			const shown = Math.min(height, p.room);
			const [from, to] = p.side === 'below' ? [p.inset, p.inset + shown] : [VIEW_H - p.inset - shown, VIEW_H - p.inset];
			assert.ok(from >= 12 && to <= VIEW_H - 12, `inside viewport at top=${top} height=${height}`);
			const visible = t.bottom > 0 && t.top < VIEW_H;
			if (visible && shown > 0) {
				assert.ok(to <= t.top || from >= t.bottom, `link uncovered at top=${top} height=${height}`);
			}
		}
	}
});

test('a link scrolled out of view pins the preview to the nearest viewport edge', () => {
	assert.deepEqual(place(target(-100), 576, 300), { side: 'below', left: 100, inset: 12, room: 876 });
	assert.deepEqual(place(target(1000), 576, 300), { side: 'above', left: 100, inset: 12, room: 876 });
});

test('the preview aligns with the link horizontally and stays inside the window', () => {
	assert.equal(place(target(100, 900), 576, 300).left, 1200 - 576 - 12);
	assert.equal(place(target(100, 4), 576, 300).left, 12);
	assert.equal(place(target(100, 200), 576, 300, 500).left, 12);
});
