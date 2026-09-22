/**
 * What `invalidate()` is for: an asset's BYTES changing under a stable id.
 *
 * The editor's asset store is mutable — a crop or a cutout is written back over the
 * original, which keeps the id, revokes the object URL and leaves every renderer holding a
 * dead `blob:` URL. Nothing about the scene text changed, so no re-parse reaches the stage
 * and nothing else would ever replace it.
 *
 * The other half of each test is the part that has to keep working: an ordinary apply must
 * NOT re-fetch, because re-pointing an `<img>` restarts animated WebP playback and flashes.
 */

import type {Stage, StageEntity} from '@sliders/scene-types';
import {DomRenderer} from '../dom-renderer';
import {createStubResolver} from '../stub-resolver';

function makeMount(width = 1600, height = 900): HTMLElement {
	const el = document.createElement('div');

	Object.defineProperty(el, 'clientWidth', {value: width, configurable: true});
	Object.defineProperty(el, 'clientHeight', {value: height, configurable: true});
	document.body.appendChild(el);

	return el;
}

function stage(over: Partial<Stage> = {}): Stage {
	return {
		camera: {at: {x: 0, y: 0}, zoom: 1},
		entities: {},
		fx: [],
		...over
	};
}

const LAMP: StageEntity = {
	at: {x: 0, y: 0},
	flip: false,
	id: 'lamp',
	kind: 'prop',
	opacity: 1,
	ref: 'lamp',
	scale: 1,
	z: 1
};

/** A prop on stage, so the entity path is exercised as well as the backdrop's. */
const PROP = stage({bg: 'hall', entities: {lamp: LAMP}});

function bgSrc(mount: HTMLElement): string | undefined {
	return (mount.querySelector('img.sliders-bg') as HTMLImageElement | null)?.src;
}

function propSrc(mount: HTMLElement): string | undefined {
	return (
		mount.querySelector('[data-entity-id="lamp"] img') as HTMLImageElement | null
	)?.src;
}

async function mounted() {
	const mount = makeMount();
	const renderer = new DomRenderer();
	const assets = createStubResolver();

	await renderer.mount(mount, assets);

	return {assets, mount, renderer};
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('invalidate', () => {
	it('re-resolves a sprite whose bytes changed under the same id', async () => {
		const {assets, mount, renderer} = await mounted();

		await renderer.apply(PROP, []);

		const before = propSrc(mount);

		assets.define('lamp', {color: '#ff0000'});
		renderer.invalidate();
		await renderer.apply(PROP, []);

		expect(propSrc(mount)).not.toBe(before);
	});

	it('re-resolves a BACKDROP whose bytes changed under the same id', async () => {
		// `syncBg` early-returns on an unchanged id, so before `invalidate()` forgot the
		// backdrop this was the one surface a library change could not reach: the author
		// re-cropped their `bg:` and the stage kept the revoked URL until they swapped
		// scenes or reloaded.
		const {assets, mount, renderer} = await mounted();

		await renderer.apply(PROP, []);

		const before = bgSrc(mount);

		assets.define('hall', {color: '#00ff00'});
		renderer.invalidate();
		await renderer.apply(PROP, []);

		expect(bgSrc(mount)).not.toBe(before);
	});

	it('leaves exactly one backdrop behind, not a stack of them', async () => {
		// `syncBg` drops what the LAST backdrop left; forgetting the id without handing it
		// the live element would pile up one dead `<img>` per library change.
		const {assets, mount, renderer} = await mounted();

		await renderer.apply(PROP, []);

		for (const color of ['#001122', '#334455', '#667788']) {
			assets.define('hall', {color});
			renderer.invalidate();
			await renderer.apply(PROP, []);
		}

		expect(mount.querySelectorAll('img.sliders-bg')).toHaveLength(1);
	});

	it('re-points nothing on an ordinary apply, so an animated asset keeps playing', async () => {
		const {assets, mount, renderer} = await mounted();

		await renderer.apply(PROP, []);

		const bg = bgSrc(mount);
		const prop = propSrc(mount);

		// The bytes moved and nobody said so: the renderer is entitled to its cache, and
		// keeping it is what stops a keystroke from restarting every WebP on stage.
		assets.define('hall', {color: '#123456'});
		assets.define('lamp', {color: '#654321'});
		await renderer.apply(PROP, []);

		expect(bgSrc(mount)).toBe(bg);
		expect(propSrc(mount)).toBe(prop);
	});

	it('forgets one asset by id, and leaves the rest cached', async () => {
		const {assets, mount, renderer} = await mounted();

		await renderer.apply(PROP, []);

		const bg = bgSrc(mount);
		const prop = propSrc(mount);

		assets.define('hall', {color: '#abcdef'});
		assets.define('lamp', {color: '#fedcba'});
		renderer.invalidate('lamp');
		await renderer.apply(PROP, []);

		expect(propSrc(mount)).not.toBe(prop);
		expect(bgSrc(mount)).toBe(bg);
	});
});
