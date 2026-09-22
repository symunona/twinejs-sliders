import type {AssetMeta, GlitchEffect} from '@sliders/scene-types';
import {MemoryBackend} from '../backends/memory-backend';
import {BackedAssetStore} from '../store';
import {jpegBytes, pngBytes} from '../test-fixtures';

// jsdom ships getRandomValues but not SubtleCrypto.
beforeAll(() => {
	if (!globalThis.crypto?.subtle) {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const {webcrypto} = require('crypto');

		Object.defineProperty(globalThis, 'crypto', {
			configurable: true,
			value: webcrypto
		});
	}
});

const GLITCH: GlitchEffect = {
	kind: 'glitch',
	amount: 40,
	bands: 6,
	burst: 50,
	noise: 0,
	period: 2,
	rotate: 0,
	scanlines: 0,
	speed: 24,
	split: 25
};

function file(bytes: Uint8Array, name: string, type: string) {
	return new File([bytes], name, {type});
}

function newStore() {
	return new BackedAssetStore(new MemoryBackend());
}

describe('asset effects in the store', () => {
	it('stores an effect handed to putAsset', async () => {
		const store = newStore();
		const {id} = await store.putAsset(file(pngBytes(), 'sign.png', 'image/png'), {
			effect: GLITCH
		});

		expect((await store.meta(id))?.effect).toEqual(GLITCH);
	});

	it('leaves an asset with no effect carrying none', async () => {
		const store = newStore();
		const {id} = await store.putAsset(file(pngBytes(), 'sign.png', 'image/png'));

		expect((await store.meta(id))?.effect).toBeUndefined();
	});

	it('KEEPS the effect across a replace', async () => {
		// The one rule worth a test of its own. `replace` overwrites `edits`, `mask` and
		// `tuning` on purpose -- those describe a render of bytes that just changed. An
		// effect describes how to DRAW whatever the bytes are, so it survives, exactly the
		// way the name and the tags do. Cleared here, every re-crop would silently strip an
		// asset's look.
		const store = newStore();
		const {id} = await store.putAsset(file(pngBytes(), 'sign.png', 'image/png'), {
			effect: GLITCH
		});

		await store.replace(id, file(jpegBytes(), 'sign.jpg', 'image/jpeg'));

		expect((await store.meta(id))?.effect).toEqual(GLITCH);
	});

	it('clears the effect when update is asked to', async () => {
		const store = newStore();
		const {id} = await store.putAsset(file(pngBytes(), 'sign.png', 'image/png'), {
			effect: GLITCH
		});

		await store.update(id, {effect: undefined});
		expect((await store.meta(id))?.effect).toBeUndefined();
	});

	it('carries the effect through a bundle import', async () => {
		// Unlike a sidecar, which is local to the device that made the edit. An effect has to
		// reach every reader, so the importer must not strip it the way it strips `edits`.
		const store = newStore();
		const bytes = pngBytes();
		const meta: AssetMeta = {
			animated: false,
			bytes: bytes.length,
			edits: undefined,
			effect: GLITCH,
			h: 1,
			hash: 'deadbeef',
			id: 'a_sign',
			kind: 'bg',
			mime: 'image/png',
			name: 'sign',
			tags: [],
			w: 1
		};

		const stored = await store.importAsset(meta, new Blob([bytes]));

		expect(stored.effect).toEqual(GLITCH);
	});
});
