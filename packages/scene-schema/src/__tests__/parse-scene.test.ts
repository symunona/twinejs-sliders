/**
 * @jest-environment-options {"customExportConditions": ["node"]}
 */
import {LAYER_BASELINE} from '@sliders/scene-types';
import {parseScene} from '../parse-scene';
import type {SayBeat, SceneError, SetBeat} from '@sliders/scene-types';

function codes(errors: SceneError[]): string[] {
	return errors.map(e => e.code);
}

function find(errors: SceneError[], code: string): SceneError | undefined {
	return errors.find(e => e.code === code);
}

const SPEC_EXAMPLE = `id: tavern-night
from: ~
bg: tavern/night
camera: {at: [0, 0], zoom: 1}

cast:
  mira:  {at: -0.4, frame: arms-crossed}
  joren: {at: 0.35, frame: idle, flip: true, layer: back}

props:
  candle: {at: [0.1, -0.2], layer: front}
  table:  {at: 0}

fx: [rain@0.6]

beats:
  - mira: "You shouldn't have come back."
  - joren: "And yet."
  - mira: {frame: angry, at: -0.25, say: "Get out."}
  - wait: 0.5
  - mark: tense
  - box: "The candle gutters."
  - mira: "Will you [[stay]] or [[go]]?"

links:
  stay: {to: Tavern Fight, if: has_weapon, icon: sword}
  go:   {to: Street, transition: fade}
`;

describe('parseScene', () => {
	describe('the spec 02 example', () => {
		const {scene, errors} = parseScene(SPEC_EXAMPLE);

		it('parses without errors', () => {
			expect(errors).toEqual([]);
		});

		it('reads the scalar top-level keys', () => {
			expect(scene.id).toBe('tavern-night');
			expect(scene.bg).toBe('tavern/night');
			// `from: ~` is the documented "no parent" placeholder, not a patch.
			expect(scene.from).toBeUndefined();
		});

		it('reads the camera', () => {
			expect(scene.camera).toEqual({at: {x: 0, y: 0}, zoom: 1});
		});

		it('makes cast and props entity patches keyed by id', () => {
			expect(scene.entities.mira).toEqual({
				at: {x: -0.4, y: LAYER_BASELINE},
				frame: 'arms-crossed',
				kind: 'cast',
				ref: 'mira'
			});
			expect(scene.entities.joren).toEqual({
				at: {x: 0.35, y: LAYER_BASELINE},
				flip: true,
				frame: 'idle',
				kind: 'cast',
				layer: 'back',
				ref: 'joren'
			});
			expect(scene.entities.candle).toEqual({
				at: {x: 0.1, y: -0.2},
				kind: 'prop',
				layer: 'front',
				ref: 'candle'
			});
		});

		it('parses fx tokens', () => {
			expect(scene.fx).toEqual([{amount: 0.6, id: 'rain'}]);
		});

		it('parses every beat form, indexed in order', () => {
			expect(scene.beats.map(b => b.kind)).toEqual([
				'say',
				'say',
				'say',
				'wait',
				'mark',
				'box',
				'say'
			]);
			expect(scene.beats.map(b => b.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);

			const speak = scene.beats[0] as SayBeat;

			expect(speak.who).toBe('mira');
			expect(speak.text).toBe("You shouldn't have come back.");
			expect(speak.patch).toBeUndefined();

			const both = scene.beats[2] as SayBeat;

			expect(both.text).toBe('Get out.');
			expect(both.patch).toEqual({at: {x: -0.25, y: LAYER_BASELINE}, frame: 'angry'});
		});

		it('parses links', () => {
			expect(scene.links.stay).toEqual({
				icon: 'sword',
				if: 'has_weapon',
				name: 'stay',
				to: 'Tavern Fight'
			});
			expect(scene.links.go).toEqual({
				name: 'go',
				to: 'Street',
				transition: 'fade'
			});
		});
	});

	describe('coordinates', () => {
		it('reads a bare number as x, with y at the baseline', () => {
			const {scene, errors} = parseScene('cast:\n  mira: {at: -0.4}\n');

			expect(errors).toEqual([]);
			expect(scene.entities.mira).toMatchObject({at: {x: -0.4, y: LAYER_BASELINE}});
		});

		it('reads a pair as [x, y]', () => {
			const {scene, errors} = parseScene('cast:\n  mira: {at: [0.2, -0.7]}\n');

			expect(errors).toEqual([]);
			expect(scene.entities.mira).toMatchObject({at: {x: 0.2, y: -0.7}});
		});

		it('warns but still parses when out of -1..1', () => {
			const {scene, errors} = parseScene('cast:\n  mira: {at: [4, -9]}\n');

			expect(codes(errors)).toEqual(['bad-coordinate', 'bad-coordinate']);
			expect(errors.every(e => e.severity === 'warning')).toBe(true);
			expect(scene.entities.mira).toMatchObject({at: {x: 4, y: -9}});
		});

		it('rejects a non-numeric at', () => {
			const {errors} = parseScene('cast:\n  mira: {at: over there}\n');

			expect(find(errors, 'bad-coordinate')?.severity).toBe('error');
		});

		it('rejects a three-element at', () => {
			const {errors} = parseScene('cast:\n  mira: {at: [0, 0, 0]}\n');

			expect(codes(errors)).toEqual(['bad-coordinate']);
		});
	});

	describe('scale', () => {
		it('reads a positive number on cast and props alike', () => {
			const {errors, scene} = parseScene(
				'cast:\n  mira: {at: -0.4, scale: 1.15}\nprops:\n  candle: {at: [0.1, -0.2], scale: 0.6, layer: front}\n'
			);

			expect(errors).toEqual([]);
			expect(scene.entities.mira).toMatchObject({scale: 1.15});
			expect(scene.entities.candle).toMatchObject({scale: 0.6, layer: 'front'});
		});

		it('reads a scale inside a beat patch', () => {
			const {errors, scene} = parseScene(
				'cast:\n  mira: {at: 0}\nbeats:\n  - mira: {scale: 2, say: "Bigger."}\n'
			);

			expect(errors).toEqual([]);
			expect((scene.beats[0] as SayBeat).patch).toEqual({scale: 2});
		});

		it('rejects zero and negative — a vanished or inverted sprite reads as a bug', () => {
			for (const bad of ['0', '-1']) {
				const {errors, scene} = parseScene(`cast:\n  mira: {scale: ${bad}}\n`);

				expect(codes(errors)).toEqual(['bad-value']);
				expect(errors[0].severity).toBe('error');
				expect(errors[0].line).toBe(2);
				// Still an entity, just at its natural size.
				expect(scene.entities.mira).not.toMatchObject({scale: Number(bad)});
			}
		});

		it('rejects a non-numeric scale', () => {
			const {errors} = parseScene('cast:\n  mira: {scale: huge}\n');

			expect(find(errors, 'bad-value')?.severity).toBe('error');
		});

		it('warns above 10 but keeps the value', () => {
			const {errors, scene} = parseScene('cast:\n  mira: {scale: 40}\n');

			expect(codes(errors)).toEqual(['bad-value']);
			expect(errors[0].severity).toBe('warning');
			expect(scene.entities.mira).toMatchObject({scale: 40});
		});
	});

	describe('layers', () => {
		it('accepts back, mid and front', () => {
			const {errors} = parseScene(
				'cast:\n  a: {layer: back}\n  b: {layer: mid}\n  c: {layer: front}\n'
			);

			expect(errors).toEqual([]);
		});

		it('rejects anything else', () => {
			const {errors, scene} = parseScene('cast:\n  mira: {layer: foreground}\n');

			expect(codes(errors)).toEqual(['bad-layer']);
			expect(errors[0].line).toBe(2);
			// Still returns the entity, just without the bad layer.
			expect(scene.entities.mira).toMatchObject({kind: 'cast', ref: 'mira'});
		});
	});

	describe('unknown keys', () => {
		it('suggests the nearest top-level key', () => {
			const {errors} = parseScene('char:\n  mira: {at: 0}\n');

			expect(errors[0].code).toBe('unknown-key');
			expect(errors[0].hint).toBe("Did you mean 'cast'?");
			expect(errors[0].line).toBe(1);
			expect(errors[0].col).toBe(1);
		});

		it('suggests the nearest entity key', () => {
			const {errors} = parseScene('cast:\n  mira: {fram: angry}\n');

			expect(errors[0].code).toBe('unknown-key');
			expect(errors[0].hint).toBe("Did you mean 'frame'?");
		});

		it('omits the hint when nothing is close', () => {
			const {errors} = parseScene('supercalifragilistic: 1\n');

			expect(errors[0].code).toBe('unknown-key');
			expect(errors[0].hint).toBeUndefined();
		});

		it('rejects say: outside a beat', () => {
			const {errors} = parseScene('cast:\n  mira: {say: hello}\n');

			expect(codes(errors)).toEqual(['unknown-key']);
		});
	});

	describe('removal', () => {
		it('records a null entity as a removal when from: is set', () => {
			const {scene, errors} = parseScene('from: other\ncast:\n  mira: ~\n');

			expect(errors).toEqual([]);
			expect(scene.entities.mira).toBeNull();
			expect('mira' in scene.entities).toBe(true);
		});

		it('rejects a null entity without from:, in either key order', () => {
			expect(codes(parseScene('cast:\n  mira: ~\n').errors)).toEqual(['bad-value']);
			// `from:` appearing after `cast:` must not change the verdict.
			expect(codes(parseScene('cast:\n  mira: ~\nfrom: other\n').errors)).toEqual([]);
		});
	});

	describe('!only', () => {
		it('sets replaceCast for the block form', () => {
			const {scene, errors} = parseScene(
				'from: other\ncast: !only\n  mira: {at: 0}\n'
			);

			expect(errors).toEqual([]);
			expect(scene.replaceCast).toBe(true);
			expect(scene.entities.mira).toBeDefined();
		});

		it('sets replaceCast for the flow form', () => {
			const {scene} = parseScene('from: other\ncast: !only {mira: {at: 0}}\n');

			expect(scene.replaceCast).toBe(true);
		});

		it('sets replaceProps for props', () => {
			const {scene, errors} = parseScene('from: other\nprops: !only {candle: {at: 0}}\n');

			expect(errors).toEqual([]);
			expect(scene.replaceProps).toBe(true);
			expect(scene.replaceCast).toBeUndefined();
		});
	});

	describe('the subset', () => {
		it('rejects anchors and aliases', () => {
			const {errors} = parseScene(
				'cast:\n  mira: &pose {at: 0}\n  joren: *pose\n'
			);

			expect(codes(errors)).toContain('subset-violation');
			expect(errors.filter(e => e.code === 'subset-violation')).toHaveLength(2);
		});

		it('rejects tags other than !only', () => {
			const {errors} = parseScene('id: !!str 12\n');

			expect(codes(errors)).toContain('subset-violation');
		});

		it('rejects folded scalars', () => {
			const {errors} = parseScene('beats:\n  - box: >\n      folded text\n');

			expect(codes(errors)).toContain('subset-violation');
		});

		it('accepts literal block scalars', () => {
			const {errors, scene} = parseScene('beats:\n  - box: |\n      literal text\n');

			expect(errors).toEqual([]);
			expect(scene.beats).toHaveLength(1);
		});

		it('rejects multiple documents', () => {
			const {errors} = parseScene('id: a\n---\nid: b\n');

			expect(codes(errors)).toContain('subset-violation');
		});

		it('reads YAML 1.2 scalars, so `no` stays a string', () => {
			const {scene} = parseScene('bg: no\n');

			expect(scene.bg).toBe('no');
		});
	});

	describe('beats', () => {
		it('makes a set beat when a map has no say', () => {
			const {scene, errors} = parseScene('beats:\n  - mira: {at: -0.2}\n');

			expect(errors).toEqual([]);

			const beat = scene.beats[0] as SetBeat;

			expect(beat.kind).toBe('set');
			expect(beat.who).toBe('mira');
			expect(beat.patch).toEqual({at: {x: -0.2, y: LAYER_BASELINE}});
		});

		it('parses wait, fx and mark', () => {
			const {scene, errors} = parseScene(
				'beats:\n  - wait: 0.5\n  - fx: thunder\n  - fx: rain@0.25\n  - mark: tense\n'
			);

			expect(errors).toEqual([]);
			expect(scene.beats[0]).toEqual({index: 0, kind: 'wait', seconds: 0.5});
			expect(scene.beats[1]).toEqual({
				fx: {amount: 1, id: 'thunder'},
				index: 1,
				kind: 'fx'
			});
			expect(scene.beats[2]).toEqual({
				fx: {amount: 0.25, id: 'rain'},
				index: 2,
				kind: 'fx'
			});
			expect(scene.beats[3]).toEqual({index: 3, kind: 'mark', name: 'tense'});
		});

		it('rejects a beat with two keys but keeps the first', () => {
			const {scene, errors} = parseScene('beats:\n  - mira: "hi"\n    wait: 1\n');

			expect(codes(errors)).toEqual(['bad-value']);
			expect(scene.beats).toHaveLength(1);
			expect(scene.beats[0].kind).toBe('say');
		});

		it('keeps indices contiguous when a beat is dropped', () => {
			const {scene, errors} = parseScene(
				'beats:\n  - mira: "one"\n  - just a string\n  - mira: "two"\n'
			);

			expect(codes(errors)).toEqual(['bad-value']);
			expect(scene.beats.map(b => b.index)).toEqual([0, 1]);
		});
	});

	describe('links', () => {
		it('creates an entry from the inline form', () => {
			const {scene, errors} = parseScene(
				'beats:\n  - mira: "Go [[out -> The Street]]?"\n'
			);

			expect(errors).toEqual([]);
			expect(scene.links.out).toEqual({name: 'out', to: 'The Street'});
		});

		it('lets links: win over an inline target', () => {
			const {scene} = parseScene(
				'beats:\n  - mira: "[[out -> Wrong]]"\nlinks:\n  out: {to: Right}\n'
			);

			expect(scene.links.out.to).toBe('Right');
		});

		it('reports a bare link with no entry', () => {
			const {errors} = parseScene('beats:\n  - mira: "Will you [[stay]]?"\n');

			expect(codes(errors)).toEqual(['unknown-link']);
			expect(errors[0].line).toBe(2);
			expect(errors[0].hint).toContain('stay');
		});

		it('accepts a bare link declared after the beats', () => {
			const {errors} = parseScene(
				'beats:\n  - mira: "[[stay]]"\nlinks:\n  stay: {to: Fight}\n'
			);

			expect(errors).toEqual([]);
		});

		it('finds links in box text too', () => {
			const {scene} = parseScene('beats:\n  - box: "The door is [[ajar -> Hall]]."\n');

			expect(scene.links.ajar.to).toBe('Hall');
		});

		it('reports a links entry with no target', () => {
			const {errors} = parseScene('links:\n  stay: {if: brave}\n');

			expect(codes(errors)).toEqual(['bad-value']);
		});
	});

	describe('best-effort parsing', () => {
		it('still returns a scene for malformed YAML', () => {
			const {scene, errors} = parseScene(
				'id: broken\nbg: tavern/night\ncast:\n  mira: {at: 0\nbeats:\n  - mira: "hi"\n'
			);

			expect(errors.length).toBeGreaterThan(0);
			expect(scene).toBeDefined();
			expect(scene.id).toBe('broken');
			expect(scene.bg).toBe('tavern/night');
		});

		it('returns an empty scene for empty text', () => {
			const {scene, errors} = parseScene('');

			expect(errors).toEqual([]);
			expect(scene).toEqual({beats: [], entities: {}, links: {}});
		});

		it('returns a scene for text that is not a map at all', () => {
			const {scene, errors} = parseScene('just some prose\n');

			expect(errors.length).toBeGreaterThan(0);
			expect(scene.beats).toEqual([]);
		});

		it('gives every error a 1-indexed position', () => {
			const {errors} = parseScene(
				'char: 1\ncast:\n  mira: {layer: nope, at: 5, wat: 1}\nbeats:\n  - mira: "[[x]]"\n'
			);

			expect(errors.length).toBeGreaterThan(3);

			for (const error of errors) {
				expect(error.line).toBeGreaterThanOrEqual(1);
				expect(error.col).toBeGreaterThanOrEqual(1);
				expect(typeof error.message).toBe('string');
			}
		});
	});
});
