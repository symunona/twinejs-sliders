/**
 * @jest-environment node
 */
/**
 * Particles dialog = the particle system's DEFAULTS. An edit there lands on the emitter
 * asset wherever it lives (the shared pack too), every scene using it follows, and a
 * scene's own `emit:` keys still win.
 */
import {resolveEmit} from '@sliders/scene-types';
import {png} from '../../../../packages/asset-library/src/testing/fixtures';
import {World} from '../../../../packages/asset-library/src/testing/world';
import {
	LibraryAssetStore,
	SharedAssetError
} from '../../../store/asset-library/story-asset-store';
import {emitterEditScope, saveEmitterDefaults} from '../save-emitter';

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

/** Pack collection `particles` holding `fire`, attached to S1 (ana) and S2 (bo). */
async function packWorld() {
	const [world, ana, bo] = await World.create(['ana', 'bo']);
	const pack = ana.engine.createCollection({name: 'particles'});
	const {asset: fire} = await ana.engine.addAsset(png('red'), 'image/png', {
		collection: pack.id,
		kind: 'fx',
		name: 'fire',
		recipe: {particles: {box: {h: 320, w: 200}, rate: 70, speed: 0.4}}
	});
	const s1 = new LibraryAssetStore('S1', async () => ana.engine);
	const s2 = new LibraryAssetStore('S2', async () => bo.engine);

	await s1.ownCollection();
	ana.engine.bind('S1', [pack.id]);
	ana.engine.setRefs('S1', [fire!.id]);
	await world.settle();
	await s2.ownCollection();
	bo.engine.bind('S2', [pack.id]);
	bo.engine.setRefs('S2', [fire!.id]);
	await world.settle();

	return {ana, fire: fire!, pack, s1, s2, world};
}

describe('saveEmitterDefaults', () => {
	it('regression: a plain update of a pack emitter throws, the dialog save does not', async () => {
		const {fire, s1} = await packWorld();

		// What the dialog did before: red "fire is shared … pass {scope}" on every knob.
		await expect(
			s1.update(fire.id, {particles: {speed: 1.5}})
		).rejects.toBeInstanceOf(SharedAssetError);

		const saved = await saveEmitterDefaults(s1, fire.id, {
			particles: {box: {h: 320, w: 200}, rate: 70, speed: 1.5}
		});

		expect(saved.id).toBe(fire.id);
		expect(saved.particles?.speed).toBe(1.5);
	});

	it('every story using the emitter follows; scene overrides still win', async () => {
		const {fire, s1, s2, world} = await packWorld();

		await saveEmitterDefaults(s1, fire.id, {
			particles: {box: {h: 320, w: 200}, rate: 12, speed: 1.5}
		});
		await world.settle();

		const other = (await s2.lookup('fire'))!;

		expect(other.particles).toMatchObject({rate: 12, speed: 1.5});

		// A scene with `emit: {speed: 2}` keeps its speed, takes the new rate.
		const params = resolveEmit(other.particles, {speed: 2});

		expect(params.speed).toBe(2);
		expect(params.rate).toBe(12);
		// One without overrides takes both.
		expect(resolveEmit(other.particles, undefined)).toMatchObject({
			rate: 12,
			speed: 1.5
		});
	});

	it('locked pack: edits go to this story own copy, which the name now finds', async () => {
		const {ana, fire, pack, s1, s2, world} = await packWorld();

		ana.engine.updateCollection(pack.id, {locked: true});

		const saved = await saveEmitterDefaults(s1, fire.id, {
			particles: {box: {h: 320, w: 200}, rate: 70, speed: 2.5}
		});

		await world.settle();
		expect(saved.id).not.toBe(fire.id);
		expect((await s1.lookup('fire'))!.particles?.speed).toBe(2.5);
		expect((await s2.lookup('fire'))!.particles?.speed).toBe(0.4);
	});

	it('own emitter nobody else uses needs no scope', async () => {
		const [, ana] = await World.create(['ana']);
		const store = new LibraryAssetStore('S1', async () => ana.engine);
		const {meta} = await store.putAsset(
			new File([png('red')], 'fire.png', {type: 'image/png'}),
			{kind: 'fx', name: 'fire', particles: {speed: 0.4}}
		);

		expect(emitterEditScope(await store.sharedInfo(meta.id))).toBeUndefined();
		expect(
			(await saveEmitterDefaults(store, meta.id, {particles: {speed: 0.9}}))
				.particles?.speed
		).toBe(0.9);
	});
});
