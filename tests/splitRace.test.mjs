import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './splitHarness.mjs';

for (const key of ['v', 'V', 'h', 'H']) {
	for (const adjacent of [false, true]) {
		for (const phase of ['create', 'opening']) {
			test(`${key}, adjacent=${adjacent}, source DOM replacement during ${phase}`, async () => {
				const h = harness({ adjacent, below: key.toLowerCase() === 'h', reflow: phase });
				h.start(key);
				if (phase === 'opening') { h.replaceLink(); h.emit('layout-change'); h.session.resize(); }
				const result = await h.settle();
				assert.equal(result.opened, true, h.trace.join(' -> '));
				assert.equal(h.active, h.target);
				assert.ok(h.leaves.includes(h.target));
				assert.equal(h.session.isOpeningSplit(), false);
				assert.ok(h.trace.includes(`create:${adjacent && key === key.toLowerCase() ? 'tab' : key.toLowerCase() === 'v' ? 'vertical' : 'horizontal'}`));
				if (adjacent) assert.ok(h.leaves.includes(h.neighbor));
			});
		}
	}
}

for (const subpath of ['#heading', '#^block']) {
	test(`pop-out document retains ${subpath} navigation after reflow`, async () => {
		const h = harness({ subpath, popout: true, reflow: 'create' });
		h.start();
		assert.equal((await h.settle()).opened, true);
		assert.deepEqual(h.target.ephemeral, { subpath });
		assert.deepEqual(h.target.openState, { state: { mode: 'preview' }, active: true });
		assert.ok(h.trace.lastIndexOf('focus') < h.trace.indexOf('subpath'));
	});
}

test('same-pane Enter bypasses split creation', () => {
	const h = harness({ subpath: '#heading' });
	h.key('Enter');
	assert.deepEqual(h.trace, [['same-pane', 'target#heading', 'source.md', false]]);
});

test('unconfirmed detached anchor still invalidates preview', () => {
	const h = harness();
	h.key('v'); h.replaceLink(); h.emit('layout-change'); h.key('Enter');
	assert.equal(h.target, undefined);
	assert.equal(h.session.focusedTarget, null);
});

for (const [name, cancel] of Object.entries({
	Escape: h => h.key('Escape'),
	unload: h => h.handler.cleanup(),
	windowClose: h => h.emit('window-close', { doc: h.doc }),
	closedWindow: h => { h.doc.defaultView.closed = true; },
	sourceRemoval: h => h.source.detach(),
	sourceNavigation: h => { h.source.view.file = h.otherFile; },
	sourceModeChange: h => { h.source.view.mode = 'source'; },
	sourceDocumentChange: h => { h.source.view.containerEl.ownerDocument = {}; },
})) {
	test(`${name} cancels a slow open even after source reflow`, async () => {
		const h = harness(); h.start(); h.replaceLink(); h.emit('layout-change');
		cancel(h);
		const result = await h.settle();
		assert.equal(result.cancelled, true, h.trace.join(' -> '));
		assert.ok(!h.leaves.includes(h.target));
		assert.equal(h.session.isOpeningSplit(), false);
	});
}

test('repeated keys during slow opening do not create more destinations', async () => {
	const h = harness(); h.start(); h.replaceLink();
	for (const key of ['v', 'Enter', 'V', 'h', 'H', 'Enter']) h.key(key);
	assert.equal((await h.settle()).opened, true);
	assert.equal(h.trace.filter(event => event.startsWith('create:')).length, 1);
});

test('user switching destinations is not overridden on completion', async () => {
	const h = harness({ adjacent: true }); h.start();
	h.workspace.setActiveLeaf(h.neighbor, { focus: true });
	assert.equal((await h.settle()).cancelled, true);
	assert.equal(h.active, h.neighbor);
	assert.ok(h.leaves.includes(h.neighbor));
	assert.ok(!h.leaves.includes(h.target));
});

for (const [name, repurpose] of Object.entries({
	pinned: h => { h.target.pinned = true; },
	otherFile: h => { h.target.view.file = h.otherFile; },
	editor: h => { h.target.view.mode = 'source'; },
})) {
	test(`cancellation preserves a ${name} destination`, async () => {
		const h = harness(); h.start(); repurpose(h); h.key('Escape');
		assert.equal((await h.settle()).cancelled, true);
		assert.ok(h.leaves.includes(h.target));
		assert.equal(h.active, h.target);
	});
}

test('workspace returning a pre-existing tab never detaches it', async t => {
	const h = harness({ adjacent: true });
	h.workspace.getLeaf = () => h.neighbor;
	const errors = t.mock.method(console, 'error', () => {});
	h.start();
	assert.equal((await h.settle()).opened, false);
	assert.ok(h.leaves.includes(h.neighbor));
	assert.equal(errors.mock.callCount(), 1);
});

test('opening errors clean up only the newly created destination', async t => {
	const h = harness({ adjacent: true });
	const errors = t.mock.method(console, 'error', () => {});
	h.start();
	assert.equal((await h.settle(new Error('simulated open failure'))).opened, false);
	assert.equal(errors.mock.callCount(), 1);
	assert.ok(!h.leaves.includes(h.target));
	assert.ok(h.leaves.includes(h.neighbor));
	assert.equal(h.active, h.source);
});

test('completion of a cancelled open does not invalidate a newer operation', async () => {
	const h = harness(); h.start();
	const oldTarget = h.target, oldOpening = h.opening;
	h.key('Escape');
	h.session.focusHint(h.link, 'source.md'); h.start('V');
	oldTarget.complete(); await oldOpening; await Promise.resolve();
	assert.equal(h.session.isOpeningSplit(), true);
	h.replaceLink(); h.emit('layout-change');
	assert.equal((await h.settle()).opened, true);
});

test('isCurrent tolerates source replacement without a layout event', async () => {
	const h = harness(); h.start(); h.replaceLink();
	assert.equal((await h.settle()).opened, true);
});

for (const [name, invalidate] of Object.entries({
	detachedDestination: h => h.target.detach(),
	changedResolution: h => { h.session.plugin.app.metadataCache.getFirstLinkpathDest = () => h.otherFile; },
	deferredLoadFailure: h => { h.target.loadIfDeferred = async () => { throw new Error('deferred failure'); }; },
})) {
	test(`${name} cannot finish navigation or leave an orphan preview`, async t => {
		const h = harness({ subpath: '#heading' });
		const errors = t.mock.method(console, 'error', () => {});
		h.start(); h.replaceLink(); invalidate(h);
		assert.equal((await h.settle()).opened, false);
		assert.equal(errors.mock.callCount(), 1);
		assert.equal(h.target.ephemeral, undefined);
		assert.equal(h.session.focusedTarget, null);
		assert.ok(!h.leaves.includes(h.target));
	});
}
