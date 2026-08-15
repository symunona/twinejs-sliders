import {LAYER_BASELINE} from '@sliders/scene-types';
import {emptyStage} from '@sliders/scene-types';
import type {EntityPatch, Scene, Stage} from '@sliders/scene-types';
import {applyScene} from '../apply-scene';
import {resolveZ} from '../stage';

function scene(partial: Partial<Scene> = {}): Scene {
	return {beats: [], entities: {}, links: {}, ...partial};
}

function cast(patch: Partial<EntityPatch> & {ref?: string}): EntityPatch {
	return {kind: 'cast', ref: patch.ref ?? 'x', ...patch};
}

/** A stage with mira and a candle already on it, used as the `from:` base. */
function baseStage(): Stage {
	return applyScene(
		emptyStage(),
		scene({
			bg: 'tavern/night',
			entities: {
				candle: {at: {x: 0.5, y: 0}, kind: 'prop', layer: 'front', ref: 'candle'},
				joren: {at: {x: 0.35, y: 0}, frame: 'idle', kind: 'cast', ref: 'joren'},
				mira: {
					at: {x: -0.4, y: 0.1},
					frame: 'arms-crossed',
					kind: 'cast',
					ref: 'mira'
				}
			},
			fx: [{amount: 0.6, id: 'rain'}]
		})
	);
}

describe('applyScene', () => {
	describe('snapshot mode (no from:)', () => {
		it('fills every omitted field with a default', () => {
			const stage = applyScene(emptyStage(), scene({entities: {mira: cast({ref: 'mira'})}}));

			expect(stage.entities.mira).toEqual({
				at: {x: 0, y: LAYER_BASELINE},
				flip: false,
				frame: undefined,
				id: 'mira',
				kind: 'cast',
				layer: 'mid',
				opacity: 1,
				ref: 'mira',
				scale: 1,
				z: undefined
			});
		});

		it('ignores the base entirely — an absent entity is removed', () => {
			const stage = applyScene(
				baseStage(),
				scene({entities: {mira: cast({ref: 'mira'})}})
			);

			expect(Object.keys(stage.entities)).toEqual(['mira']);
			expect(stage.entities.joren).toBeUndefined();
			expect(stage.entities.candle).toBeUndefined();
		});

		it('clears an absent bg, camera and fx', () => {
			const stage = applyScene(baseStage(), scene({}));

			expect(stage.bg).toBeUndefined();
			expect(stage.camera).toEqual({at: {x: 0, y: 0}, zoom: 1});
			expect(stage.fx).toEqual([]);
		});

		it('is copy-pasteable: the same scene gives the same stage from any base', () => {
			const s = scene({
				bg: 'street/day',
				entities: {mira: cast({at: {x: 0.2, y: 0}, ref: 'mira'})}
			});

			expect(applyScene(emptyStage(), s)).toEqual(applyScene(baseStage(), s));
		});

		it('never mutates the base it was handed', () => {
			const base = baseStage();
			const before = JSON.stringify(base);

			applyScene(base, scene({entities: {mira: cast({ref: 'mira'})}}));
			expect(JSON.stringify(base)).toBe(before);
		});
	});

	describe('patch mode (from: set)', () => {
		it('inherits every entity the patch does not mention', () => {
			const stage = applyScene(baseStage(), scene({from: 'tavern-night'}));

			expect(Object.keys(stage.entities).sort()).toEqual([
				'candle',
				'joren',
				'mira'
			]);
			expect(stage.bg).toBe('tavern/night');
			expect(stage.fx).toEqual([{amount: 0.6, id: 'rain'}]);
		});

		it('shallow-merges a mentioned entity onto the inherited one', () => {
			const stage = applyScene(
				baseStage(),
				scene({
					entities: {mira: cast({frame: 'angry', ref: 'mira'})},
					from: 'tavern-night'
				})
			);

			expect(stage.entities.mira).toMatchObject({
				at: {x: -0.4, y: 0.1}, // inherited
				frame: 'angry' // overridden
			});
		});

		it('removes an entity set to null', () => {
			const stage = applyScene(
				baseStage(),
				scene({entities: {joren: null}, from: 'tavern-night'})
			);

			expect(stage.entities.joren).toBeUndefined();
			expect(stage.entities.mira).toBeDefined();
		});

		it('adds an entity the base did not have, with defaults', () => {
			const stage = applyScene(
				baseStage(),
				scene({entities: {sara: cast({at: {x: 0.9, y: 0}, ref: 'sara'})}, from: 'x'})
			);

			expect(stage.entities.sara).toMatchObject({
				flip: false,
				layer: 'mid',
				opacity: 1
			});
		});

		it('inherits bg unless it is explicitly set or nulled', () => {
			expect(applyScene(baseStage(), scene({from: 'x'})).bg).toBe('tavern/night');
			expect(applyScene(baseStage(), scene({bg: 'street', from: 'x'})).bg).toBe('street');
			expect(applyScene(baseStage(), scene({bg: null, from: 'x'})).bg).toBeUndefined();
		});

		it('merges the camera partially', () => {
			const base = applyScene(
				emptyStage(),
				scene({camera: {at: {x: 0.2, y: 0.3}, zoom: 2}})
			);
			const stage = applyScene(base, scene({camera: {zoom: 3}, from: 'x'}));

			expect(stage.camera).toEqual({at: {x: 0.2, y: 0.3}, zoom: 3});
		});

		it('replaces the fx list when one is declared, and clears it when empty', () => {
			expect(
				applyScene(baseStage(), scene({from: 'x', fx: [{amount: 1, id: 'fog'}]})).fx
			).toEqual([{amount: 1, id: 'fog'}]);
			expect(applyScene(baseStage(), scene({from: 'x', fx: []})).fx).toEqual([]);
		});

		it('drops the inherited cast for cast: !only, keeping props', () => {
			const stage = applyScene(
				baseStage(),
				scene({
					entities: {mira: cast({ref: 'mira'})},
					from: 'x',
					replaceCast: true
				})
			);

			expect(Object.keys(stage.entities).sort()).toEqual(['candle', 'mira']);
			// mira is rebuilt from scratch, so the inherited frame is gone.
			expect(stage.entities.mira.frame).toBeUndefined();
		});

		it('drops the inherited props for props: !only', () => {
			const stage = applyScene(
				baseStage(),
				scene({entities: {}, from: 'x', replaceProps: true})
			);

			expect(Object.keys(stage.entities).sort()).toEqual(['joren', 'mira']);
		});
	});

	describe('resolveZ', () => {
		it('prefers an explicit z', () => {
			const stage = applyScene(
				emptyStage(),
				scene({entities: {mira: cast({at: {x: 0, y: 0.5}, ref: 'mira', z: 7})}})
			);

			expect(resolveZ(stage.entities.mira)).toBe(7);
		});

		it('derives z from y, lower on screen meaning nearer', () => {
			const stage = applyScene(
				emptyStage(),
				scene({
					entities: {
						far: cast({at: {x: 0, y: 0.5}, ref: 'far'}),
						near: cast({at: {x: 0, y: -0.5}, ref: 'near'})
					}
				})
			);

			expect(resolveZ(stage.entities.near)).toBeGreaterThan(
				resolveZ(stage.entities.far)
			);
		});
	});
});
