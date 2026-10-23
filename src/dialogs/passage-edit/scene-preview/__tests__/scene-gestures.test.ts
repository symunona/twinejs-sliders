import type {Camera, Stage} from '@sliders/scene-types';
import type {StageBox} from '@sliders/render-dom';
import {extractSceneBlock} from '@sliders/scene-index';
import {applyEdit} from '@sliders/scene-edit';
import {parseSceneText} from '../use-scene-parse';
import {buildEntityEdit} from '../use-scene-writer';
import type {EntityKeyWrite} from '../use-scene-writer';
import {
	assetDropWrites,
	cameraWrite,
	conditionWrites,
	deleteWrites,
	fitWrites,
	idsWithBeats,
	flipWrites,
	formatCamera,
	motionSpeedWrites,
	motionWrites,
	musicDropWrites,
	opacityWrites,
	poseLoopWrites,
	poseWrite,
	panCamera,
	uniqueEntityId,
	wheelZoomFactor,
	zWrites,
	zoomCamera,
	Z_STEP
} from '../scene-gestures';

/**
 * The rules, not the pixels. jsdom has no layout, so anything that needs a real stage box
 * gets a made-up one — which is fine, because every function here is total in its
 * arguments and a 640x360 box is as real as any other.
 */

const passage = [
	'[scene]',
	'cast:',
	'  mira: {at: -0.4}',
	'  joren: {at: 0.3, flip: true, layer: front}',
	'props:',
	'  candle: {at: 0.4, z: 2}'
].join('\n');

const stage: Stage = parseSceneText(passage).states[0];

const BOX: StageBox = {left: 0, top: 0, width: 640, height: 360};

describe('flipWrites()', () => {
	it('writes flip: true for an unflipped entity', () => {
		expect(flipWrites(stage, ['mira'])).toEqual([
			// `reset` is what gets written when this lands on a BEAT: a beat inherits every
			// key it does not mention, so unflipping there has to say `flip: false` out loud.
			{
				id: 'mira',
				key: 'flip',
				kind: 'cast',
				ref: 'mira',
				reset: false,
				value: true
			}
		]);
	});

	it('removes the key rather than writing flip: false', () => {
		expect(flipWrites(stage, ['joren'])[0].value).toBeUndefined();
	});

	it('toggles each of a multi-selection on its own', () => {
		expect(flipWrites(stage, ['mira', 'joren']).map(w => w.value)).toEqual([
			true,
			undefined
		]);
	});

	it('ignores ids that are not on stage', () => {
		expect(flipWrites(stage, ['nobody'])).toEqual([]);
	});
});

describe('opacityWrites()', () => {
	it('writes the value on every selected entity, to two places', () => {
		expect(opacityWrites(stage, ['mira', 'candle'], 0.4000001)).toEqual([
			{id: 'mira', key: 'opacity', kind: 'cast', ref: 'mira', reset: 1, value: 0.4},
			{
				id: 'candle',
				key: 'opacity',
				kind: 'prop',
				ref: 'candle',
				reset: 1,
				value: 0.4
			}
		]);
	});

	it('removes the key at fully opaque, and says 1 on a beat', () => {
		const [write] = opacityWrites(stage, ['mira'], 1);

		expect(write.value).toBeUndefined();
		expect(write.reset).toBe(1);
	});

	it('clamps to 0..1', () => {
		expect(opacityWrites(stage, ['mira'], -2)[0].value).toBe(0);
		expect(opacityWrites(stage, ['mira'], 3)[0].value).toBeUndefined();
	});
});

describe('zWrites()', () => {
	it('starts from the z derived from y when there is no explicit one', () => {
		// mira sits on the baseline: resolveZ is (1 - -0.85) / 2 = 0.925. Rounded on the
		// way out, so the text never grows a tail of nines.
		expect(zWrites(stage, ['mira'], 1)).toEqual([
			{id: 'mira', key: 'z', kind: 'cast', ref: 'mira', value: 1.025}
		]);
		expect(0.925 + Z_STEP).toBeCloseTo(1.025, 9);
	});

	it('reads an explicit z back out of the stage', () => {
		expect(zWrites(stage, ['candle'], -1)[0].value).toBeCloseTo(2 - Z_STEP, 5);
	});
});

describe('poseWrite()', () => {
	it('writes the chosen frame', () => {
		expect(poseWrite(stage.entities.mira, 'angry')).toEqual({
			id: 'mira',
			key: 'pose',
			kind: 'cast',
			ref: 'mira',
			value: 'angry'
		});
	});

	it('removes the key when the choice goes back to automatic', () => {
		expect(poseWrite(stage.entities.mira, undefined)?.value).toBeUndefined();
	});

	it('refuses props — they are one image and have no frames', () => {
		expect(poseWrite(stage.entities.candle, 'lit')).toBeUndefined();
	});
});

describe('motionWrites()', () => {
	const moving = parseSceneText(
		[
			'[scene]',
			'props:',
			'  hills: {motion: {id: parallax_left, speed: 12}}',
			'  sky: {}'
		].join('\n')
	).states[0];

	it('sets the token on every selected sprite, props included', () => {
		expect(motionWrites(moving, ['sky'], 'earthquake')).toEqual([
			{
				id: 'sky',
				key: 'motion',
				kind: 'prop',
				ref: 'sky',
				// On a beat, stopping has to say `motion: ~` — the motion is inherited.
				reset: null,
				value: {id: 'earthquake', speed: undefined}
			}
		]);
	});

	it("keeps each sprite's own speed", () => {
		expect(motionWrites(moving, ['hills'], 'circling')[0].value).toEqual({
			id: 'circling',
			speed: 12
		});
	});

	it('times only the sprites that move', () => {
		expect(motionSpeedWrites(moving, ['hills', 'sky'], 4)).toEqual([
			{
				id: 'hills',
				key: 'motion',
				kind: 'prop',
				ref: 'hills',
				value: {id: 'parallax_left', speed: 4}
			}
		]);
	});

	it('drops the speed back to the preset', () => {
		expect(motionSpeedWrites(moving, ['hills'], undefined)[0].value).toEqual({
			id: 'parallax_left',
			speed: undefined
		});
	});

	it('removes the key to stop', () => {
		expect(
			motionWrites(moving, ['hills', 'sky'], undefined).map(w => w.value)
		).toEqual([undefined, undefined]);
	});
});

/** One write spliced into the block and parsed back: what the text says afterwards. */
function writeBack(text: string, write: EntityKeyWrite, beat = 0) {
	const block = extractSceneBlock(text)!;
	const parse = parseSceneText(text);
	const edit = buildEntityEdit(
		{
			beat,
			blockOffset: block.offset,
			blockText: block.text,
			scene: parse.result!.scene
		},
		write
	);

	expect(edit).toBeDefined();

	return applyEdit(block.text, edit!);
}

describe('fitWrites()', () => {
	const planes = parseSceneText(
		[
			'[scene]',
			'props:',
			'  wall: {fit: cover}',
			'  sky: {}',
			'beats:',
			'  - wall: {opacity: 0.5}'
		].join('\n')
	);

	it('sets the token on the whole selection, always on the entry', () => {
		expect(fitWrites(planes.states[0], ['wall', 'sky'], 'contain')).toEqual([
			{
				entry: true,
				id: 'wall',
				key: 'fit',
				kind: 'prop',
				ref: 'wall',
				value: 'contain'
			},
			{
				entry: true,
				id: 'sky',
				key: 'fit',
				kind: 'prop',
				ref: 'sky',
				value: 'contain'
			}
		]);
	});

	it('removes the key for a sprite, even with the scrubber on a beat', () => {
		const text = [
			'[scene]',
			'props:',
			'  wall: {fit: cover}',
			'beats:',
			'  - wall: {opacity: 0.5}'
		].join('\n');
		const [write] = fitWrites(planes.states[1], ['wall'], undefined);
		const after = writeBack(text, write, 1);

		expect(after).toContain('wall: {}');
		expect(after).toContain('- wall: {opacity: 0.5}');
	});
});

describe('poseLoopWrites()', () => {
	const walking = parseSceneText(
		[
			'[scene]',
			'cast:',
			'  mira: {pose: [walk_1, walk_2], poseLoop: once}',
			'  joren: {pose: idle}',
			'props:',
			'  candle: {}'
		].join('\n')
	).states[0];

	it('writes only characters playing a step list', () => {
		expect(
			poseLoopWrites(walking, ['mira', 'joren', 'candle'], 'all')
		).toEqual([
			{
				id: 'mira',
				key: 'poseLoop',
				kind: 'cast',
				ref: 'mira',
				// On a beat the default has to be said: the loop is inherited.
				reset: 'all',
				value: 'all'
			}
		]);
	});

	it('removes the key for the default', () => {
		expect(poseLoopWrites(walking, ['mira'], undefined)[0].value).toBeUndefined();
	});
});

describe('conditionWrites()', () => {
	const text = [
		'[scene]',
		'props:',
		'  drone: {at: 0.2, if: passage.visits == 1}',
		'  sky: {}',
		'beats:',
		'  - drone: {opacity: 0.5}'
	].join('\n');
	const parse = parseSceneText(text);

	it('always lands on the entry: on a beat if: gates the beat', () => {
		const [write] = conditionWrites(parse.states[1], ['drone'], 'not tense');
		const after = writeBack(text, write, 1);

		expect(write.entry).toBe(true);
		expect(after).toContain('drone: {at: 0.2, if: not tense}');
		expect(after).toContain('- drone: {opacity: 0.5}');
	});

	it('round-trips a condition YAML would otherwise misread', () => {
		const [write] = conditionWrites(parse.states[0], ['sky'], '!lit');
		const after = writeBack(text, write);
		const scene = parseSceneText(`[scene]\n${after}`).result!.scene;

		expect(scene.entityIfs).toEqual({drone: 'passage.visits == 1', sky: '!lit'});
	});

	it('removes the key when emptied', () => {
		const [write] = conditionWrites(parse.states[0], ['drone'], undefined);

		expect(writeBack(text, write)).toContain('drone: {at: 0.2}');
	});
});

describe('deleteWrites()', () => {
	it('asks for a structural removal per selected entity', () => {
		expect(deleteWrites(stage, ['mira', 'candle'])).toEqual([
			{id: 'mira', kind: 'cast', struct: 'remove'},
			{id: 'candle', kind: 'prop', struct: 'remove'}
		]);
	});
});

describe('uniqueEntityId()', () => {
	it('keeps the plain id when nothing is using it', () => {
		expect(uniqueEntityId('mira', ['joren'])).toBe('mira');
	});

	it('numbers from 2, and skips numbers already taken', () => {
		expect(uniqueEntityId('mira', ['mira'])).toBe('mira-2');
		expect(uniqueEntityId('mira', ['mira', 'mira-2'])).toBe('mira-3');
	});
});

describe('musicDropWrites()', () => {
	it('writes the scene-top music: with the sound NAME', () => {
		expect(musicDropWrites('rain-heavy')).toEqual([
			{formatted: 'rain-heavy', sceneKey: 'music'}
		]);
	});

	it('quotes a name YAML would read as something else', () => {
		expect(musicDropWrites('yes')).toEqual([{formatted: 'yes', sceneKey: 'music'}]);
		expect(musicDropWrites('1.5')).toEqual([{formatted: '"1.5"', sceneKey: 'music'}]);
	});
});

describe('assetDropWrites()', () => {
	const at = {x: 0.25, y: -0.85};

	it('writes bg: with the asset NAME, never an id', () => {
		expect(
			assetDropWrites({ref: 'tavern/night', target: 'bg'}, at, [])
		).toEqual([{formatted: 'tavern/night', sceneKey: 'bg'}]);
	});

	// Regression: a sound tile dropped on the scene used to end up as a beat `- sfx:`.
	it('writes a sound as the scene music:, not a beat sfx', () => {
		expect(
			assetDropWrites({ref: 'rain-heavy', target: 'music'}, at, [])
		).toEqual([{formatted: 'rain-heavy', sceneKey: 'music'}]);
	});

	it('adds a cast entry keyed by the character id', () => {
		expect(assetDropWrites({ref: 'mira', target: 'cast'}, at, [])).toEqual([
			{
				id: 'mira',
				kind: 'cast',
				patch: {at, kind: 'cast', ref: 'mira'},
				struct: 'add'
			}
		]);
	});

	it('derives a prop id from the asset name and keeps the name as ref', () => {
		const [write] = assetDropWrites(
			{ref: 'props/Brass Candle', target: 'prop'},
			at,
			[]
		);

		expect(write).toMatchObject({
			id: 'brass-candle',
			kind: 'prop',
			struct: 'add'
		});
		expect((write as {patch: {ref: string}}).patch.ref).toBe(
			'props/Brass Candle'
		);
	});

	it('does not collide with an id already in the block', () => {
		const [write] = assetDropWrites({ref: 'mira', target: 'cast'}, at, [
			'mira'
		]);

		expect(write).toMatchObject({id: 'mira-2'});
	});

	it('rounds the drop position on the way in', () => {
		const [write] = assetDropWrites(
			{ref: 'mira', target: 'cast'},
			{x: 0.123456, y: -0.5},
			[]
		);

		expect((write as {patch: {at: {x: number}}}).patch.at.x).toBe(0.123);
	});
});

describe('formatCamera()', () => {
	it('always writes at as a pair — a bare number would mean the layer baseline', () => {
		expect(formatCamera({at: {x: 0.5, y: 0}, zoom: 1})).toBe('{at: [0.5, 0]}');
	});

	it('leaves out the parts that are at rest', () => {
		expect(formatCamera({at: {x: 0, y: 0}, zoom: 1.5})).toBe('{zoom: 1.5}');
	});
});

describe('cameraWrite()', () => {
	it('removes the key when the camera comes back to rest', () => {
		expect(cameraWrite({at: {x: 0, y: 0}, zoom: 1})).toEqual({
			formatted: undefined,
			sceneKey: 'camera'
		});
	});

	it('writes both parts when both moved', () => {
		expect(cameraWrite({at: {x: -0.2, y: 0.1}, zoom: 2}).formatted).toBe(
			'{at: [-0.2, 0.1], zoom: 2}'
		);
	});
});

describe('panCamera()', () => {
	const identity: Camera = {at: {x: 0, y: 0}, zoom: 1};

	it('moves the world with the pointer, so the camera moves against it', () => {
		// 64 px right on a 640 px box is 0.2 of a half width.
		const camera = panCamera(BOX, identity, {x: 100, y: 100}, {x: 164, y: 100});

		expect(camera.at.x).toBeCloseTo(-0.2, 3);
		expect(camera.at.y).toBeCloseTo(0, 3);
	});

	it('keeps the zoom it started with', () => {
		expect(
			panCamera(BOX, {at: {x: 0, y: 0}, zoom: 2}, {x: 0, y: 0}, {x: 10, y: 0})
				.zoom
		).toBe(2);
	});

	it('pans half as far in scene units when zoomed in twice as far', () => {
		const one = panCamera(BOX, identity, {x: 100, y: 0}, {x: 164, y: 0});
		const two = panCamera(
			BOX,
			{at: {x: 0, y: 0}, zoom: 2},
			{x: 100, y: 0},
			{x: 164, y: 0}
		);

		expect(two.at.x).toBeCloseTo(one.at.x / 2, 3);
	});
});

describe('zoomCamera()', () => {
	const identity: Camera = {at: {x: 0, y: 0}, zoom: 1};

	it('leaves the point under the pointer where it is', () => {
		const pointer = {x: 500, y: 90};
		const before = {
			x: (pointer.x - 320) / 320,
			y: (180 - pointer.y) / 180
		};
		const camera = zoomCamera(BOX, identity, pointer, 2);

		// Same inverse the overlay uses: scene = centre-relative / zoom + camera at.
		expect(before.x / camera.zoom + camera.at.x).toBeCloseTo(before.x, 2);
		expect(before.y / camera.zoom + camera.at.y).toBeCloseTo(before.y, 2);
	});

	it('does not zoom past its bounds', () => {
		expect(zoomCamera(BOX, identity, {x: 0, y: 0}, 1000).zoom).toBe(8);
		expect(zoomCamera(BOX, identity, {x: 0, y: 0}, 0.0001).zoom).toBe(0.2);
	});

	it('zooming about the centre never moves the camera', () => {
		expect(zoomCamera(BOX, identity, {x: 320, y: 180}, 1.5).at).toEqual({
			x: 0,
			y: 0
		});
	});
});

describe('wheelZoomFactor()', () => {
	it('zooms in on a negative delta, out on a positive one', () => {
		expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
		expect(wheelZoomFactor(100)).toBeLessThan(1);
	});

	it('is exactly reversible, so scrolling back returns to where it started', () => {
		expect(wheelZoomFactor(-100) * wheelZoomFactor(100)).toBeCloseTo(1, 9);
	});

	it('treats a wheel line as more than a trackpad pixel', () => {
		expect(wheelZoomFactor(-3, 1)).toBeGreaterThan(wheelZoomFactor(-3, 0));
	});
});

describe('idsWithBeats()', () => {
	const scene = parseSceneText(
		[
			passage,
			'beats:',
			'  - mira: "Hi."',
			'  - wait: 1',
			'    candle: {at: 0}'
		].join('\n')
	).result!.scene;

	it('names entities with a beat part, spoken or not', () => {
		expect(idsWithBeats(scene, ['mira', 'joren', 'candle'])).toEqual([
			'mira',
			'candle'
		]);
	});

	it('is empty with no scene', () => {
		expect(idsWithBeats(undefined, ['mira'])).toEqual([]);
	});
});
