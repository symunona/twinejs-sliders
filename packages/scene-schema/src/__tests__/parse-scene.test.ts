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
				ref: 'joren',
				// `layer: back` is sugar. It desugars to a z seed behind everything derived.
				z: -1
			});
			expect(scene.entities.candle).toEqual({
				at: {x: 0.1, y: -0.2},
				kind: 'prop',
				z: 2,
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
			expect(scene.entities.candle).toMatchObject({scale: 0.6, z: 2});
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

	describe('layer:, which is now sugar for z', () => {
		it('accepts back, mid and front', () => {
			const {errors} = parseScene(
				'cast:\n  a: {layer: back}\n  b: {layer: mid}\n  c: {layer: front}\n'
			);

			expect(errors).toEqual([]);
		});

		it('desugars back and front to a z seed, and mid to nothing', () => {
			const {scene} = parseScene(
				'cast:\n  a: {layer: back}\n  b: {layer: mid}\n  c: {layer: front}\n'
			);

			expect(scene.entities.a).toMatchObject({z: -1});
			// `mid` IS the y-derived order, so it writes no z at all rather than pinning
			// the entity to some number that stops tracking its y.
			expect(scene.entities.b).not.toHaveProperty('z');
			expect(scene.entities.c).toMatchObject({z: 2});
		});

		it('never writes a layer key onto the patch', () => {
			const {scene} = parseScene('cast:\n  a: {layer: front}\n');

			expect(scene.entities.a).not.toHaveProperty('layer');
		});

		it('lets an explicit z win, in EITHER key order', () => {
			// YAML map order is the author's, not a precedence rule, so both have to agree.
			expect(parseScene('cast:\n  a: {layer: front, z: 0.4}\n').scene.entities.a).toMatchObject(
				{z: 0.4}
			);
			expect(parseScene('cast:\n  a: {z: 0.4, layer: front}\n').scene.entities.a).toMatchObject(
				{z: 0.4}
			);
		});

		it('rejects anything else', () => {
			const {errors, scene} = parseScene('cast:\n  mira: {layer: foreground}\n');

			expect(codes(errors)).toEqual(['bad-layer']);
			expect(errors[0].line).toBe(2);
			// Still returns the entity, just without the bad layer.
			expect(scene.entities.mira).toMatchObject({kind: 'cast', ref: 'mira'});
			expect(scene.entities.mira).not.toHaveProperty('z');
		});
	});

	describe('entities:', () => {
		it('parses entries with kind auto — it cannot know which they are', () => {
			const {errors, scene} = parseScene(
				'entities:\n  mira: {at: -0.4, frame: idle}\n  candle: {at: 0.4}\n'
			);

			expect(errors).toEqual([]);
			expect(scene.entities.mira).toMatchObject({
				frame: 'idle',
				kind: 'auto',
				ref: 'mira'
			});
			expect(scene.entities.candle).toMatchObject({kind: 'auto', ref: 'candle'});
		});

		it('shares one id space with cast: and props:', () => {
			const {scene} = parseScene(
				'cast:\n  mira: {at: 0}\nentities:\n  candle: {at: 0.4}\n'
			);

			expect(Object.keys(scene.entities).sort()).toEqual(['candle', 'mira']);
			expect(scene.entities.mira).toMatchObject({kind: 'cast'});
		});

		it('takes the same entity keys, layer sugar included', () => {
			const {errors, scene} = parseScene(
				'entities:\n  candle: {at: 0.4, ref: lamp, scale: 0.6, layer: front}\n'
			);

			expect(errors).toEqual([]);
			expect(scene.entities.candle).toMatchObject({
				kind: 'auto',
				ref: 'lamp',
				scale: 0.6,
				z: 2
			});
		});

		it('is suggested for a near miss on the key', () => {
			const {errors} = parseScene('entites:\n  mira: {at: 0}\n');

			expect(errors[0].code).toBe('unknown-key');
			expect(errors[0].hint).toBe("Did you mean 'entities'?");
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

		it('sets replaceEntities for entities:, which names no kind at all', () => {
			const {scene, errors} = parseScene(
				'from: other\nentities: !only {candle: {at: 0}}\n'
			);

			expect(errors).toEqual([]);
			expect(scene.replaceEntities).toBe(true);
			expect(scene.replaceCast).toBeUndefined();
			expect(scene.replaceProps).toBeUndefined();
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

		it('names the missing indent when a beat body is written as siblings', () => {
			const {scene, errors} = parseScene(
				'beats:\n  - mira:\n    at: [0.1, 0.2]\n    frame: idle\n'
			);

			expect(errors).toHaveLength(1);
			expect(errors[0].message).toBe(
				"Indent these under `mira:` — at this indent they are separate beat keys, not mira's."
			);
			// Anchored at the first key that should have moved, not at the speaker.
			expect(errors[0].line).toBe(3);
			expect(scene.beats).toEqual([]);
		});

		it('still parses the first beat when only its body exploded', () => {
			const {scene, errors} = parseScene(
				'beats:\n  - mira: "hi"\n    frame: idle\n'
			);

			expect(errors).toHaveLength(1);
			expect(errors[0].message).toContain('Indent these under `mira:`');
			expect(scene.beats).toHaveLength(1);
			expect(scene.beats[0].kind).toBe('say');
		});

		it('keeps the generic message when the extra key is a second beat', () => {
			const {errors} = parseScene('beats:\n  - wait: 1\n    mark: x\n');

			expect(errors).toHaveLength(1);
			expect(errors[0].message).toBe(
				'A beat has exactly one key. Split this into two beats.'
			);
		});

		it('accepts the correctly indented body', () => {
			const {scene, errors} = parseScene(
				'beats:\n  - mira:\n      at: [0.1, 0.2]\n      frame: idle\n      say: Hello\n'
			);

			expect(errors).toEqual([]);
			expect(scene.beats).toHaveLength(1);
			expect((scene.beats[0] as SayBeat).text).toBe('Hello');
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

	// YAML 1.2 reads `04` as the number 4, so the resolved value of a passage called `04`
	// used to be the string "4" — a link to a passage nobody has, and one the story map's
	// own line scanner still drew at `04`.
	describe('names that look like numbers', () => {
		it('keeps the digits of a shorthand target', () => {
			const {scene, errors} = parseScene('links:\n  a: 04\n  c: 007\n');

			expect(errors).toEqual([]);
			expect(scene.links.a.to).toBe('04');
			expect(scene.links.c.to).toBe('007');
		});

		it('keeps the digits of a to: target', () => {
			const {scene, errors} = parseScene(
				'links:\n  a: {to: 04}\n  c: {to: 007}\n'
			);

			expect(errors).toEqual([]);
			expect(scene.links.a.to).toBe('04');
			expect(scene.links.c.to).toBe('007');
		});

		it('leaves a target YAML already made a string alone', () => {
			const {scene, errors} = parseScene(
				'links:\n  a: {to: 04 some passage}\n  b: {to: "04"}\n  c: {to: Tavern}\n'
			);

			expect(errors).toEqual([]);
			expect(scene.links.a.to).toBe('04 some passage');
			expect(scene.links.b.to).toBe('04');
			expect(scene.links.c.to).toBe('Tavern');
		});

		it('keeps the digits of the other name slots', () => {
			const {scene, errors} = parseScene(
				'id: 04\nfrom: 03\nbg: 007\ncast:\n  02: {frame: 01}\nprops:\n  05: {of: 02}\nbeats:\n  - mark: 06\n'
			);

			expect(errors).toEqual([]);
			expect(scene.id).toBe('04');
			expect(scene.from).toBe('03');
			expect(scene.bg).toBe('007');
			expect(scene.entities['02']).toMatchObject({frame: '01'});
			expect(scene.entities['05']).toMatchObject({of: '02'});
			expect(scene.beats[0]).toEqual({index: 0, kind: 'mark', name: '06'});
		});

		it('still resolves the slots that really are numbers', () => {
			const {scene, errors} = parseScene(
				'cast:\n  mira: {at: 0.50, z: 3, scale: 1.0}\nbeats:\n  - wait: 0.5\n'
			);

			expect(errors).toEqual([]);
			expect(scene.entities.mira).toMatchObject({
				at: {x: 0.5, y: LAYER_BASELINE},
				scale: 1,
				z: 3
			});
			expect(scene.beats[0]).toEqual({index: 0, kind: 'wait', seconds: 0.5});
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

describe('dur:', () => {
	function beatsOf(text: string) {
		return parseScene(`beats:\n${text}`);
	}

	it('times a beat that speaks', () => {
		const {errors, scene} = beatsOf('  - mira: {say: "Out.", dur: 2}\n');

		expect(codes(errors)).toEqual([]);
		expect(scene.beats[0]).toMatchObject({dur: 2, kind: 'say', text: 'Out.'});
	});

	it('times a beat that only stages something', () => {
		const {errors, scene} = beatsOf('  - mira: {at: 0.3, dur: 0.8}\n');

		expect(codes(errors)).toEqual([]);
		expect(scene.beats[0]).toMatchObject({dur: 0.8, kind: 'set'});
	});

	it('times a box: map', () => {
		const {errors, scene} = beatsOf('  - box: {text: "Silence.", dur: 1.5}\n');

		expect(codes(errors)).toEqual([]);
		expect(scene.beats[0]).toMatchObject({dur: 1.5, kind: 'box'});
	});

	it('is absent when the author did not write one', () => {
		const {scene} = beatsOf('  - mira: "Out."\n');

		expect(scene.beats[0].dur).toBeUndefined();
	});

	// dur times a moment, not a sprite. Accepting it here would let an author believe they
	// had slowed a character down for the whole scene.
	it('is an unknown key inside cast:', () => {
		const {errors} = parseScene('cast:\n  mira: {at: 0, dur: 1}\n');

		expect(codes(errors)).toEqual(['unknown-key']);
	});

	it('is an unknown key inside props:', () => {
		const {errors} = parseScene('props:\n  candle: {at: 0, dur: 1}\n');

		expect(codes(errors)).toEqual(['unknown-key']);
	});

	it('refuses a negative length', () => {
		const {errors, scene} = beatsOf('  - mira: {say: "Out.", dur: -1}\n');

		expect(codes(errors)).toEqual(['bad-value']);
		expect(scene.beats[0].dur).toBeUndefined();
	});

	it('warns about a length that looks like milliseconds', () => {
		const {errors, scene} = beatsOf('  - mira: {say: "Out.", dur: 500}\n');

		expect(find(errors, 'bad-value')?.severity).toBe('warning');
		// A warning, not a rejection: a minute-long hold is a legitimate effect.
		expect(scene.beats[0].dur).toBe(500);
	});

	// Zero is meaningful on a stage-only beat -- snap, then straight on -- so the warning
	// is only for a line nobody would have time to read.
	it('warns about dur: 0 on a line of dialogue', () => {
		const {errors, scene} = beatsOf('  - mira: {say: "Out.", dur: 0}\n');

		expect(find(errors, 'bad-value')?.severity).toBe('warning');
		expect(scene.beats[0].dur).toBe(0);
	});

	it('says nothing about dur: 0 on a stage-only beat', () => {
		const {errors, scene} = beatsOf('  - mira: {at: 0.3, dur: 0}\n');

		expect(codes(errors)).toEqual([]);
		expect(scene.beats[0].dur).toBe(0);
	});

	// dur times a beat; it cannot BE one. Without this the beat stages nothing and says
	// nothing, and the existing error is the right one to get.
	it('is not a beat on its own', () => {
		const {errors, scene} = beatsOf('  - mira: {dur: 1}\n');

		expect(codes(errors)).toEqual(['bad-value']);
		expect(scene.beats).toHaveLength(0);
	});

	// `- wait: 0.5` IS a duration, so it has no body map to write a second one in.
	it('has no place on a wait beat', () => {
		const {errors} = beatsOf('  - wait: {seconds: 1, dur: 1}\n');

		expect(errors.length).toBeGreaterThan(0);
	});

	it('survives the indented block form', () => {
		const {errors, scene} = beatsOf('  - mira:\n      say: "Out."\n      dur: 2\n');

		expect(codes(errors)).toEqual([]);
		expect(scene.beats[0]).toMatchObject({dur: 2, kind: 'say'});
	});
});

describe('mechanical fixes', () => {
	it('carries the suggestion an unknown key hint names, ready to apply', () => {
		const {errors} = parseScene('id: a\nchar:\n  mira: {}');
		const error = find(errors, 'unknown-key');

		expect(error?.hint).toBe("Did you mean 'cast'?");
		expect(error?.fix).toMatchObject({
			label: "Change 'char' to 'cast'",
			replaces: 'char',
			text: 'cast'
		});
	});

	it('points the fix at the key itself, not the whole entry', () => {
		const {errors} = parseScene('id: a\nchar:\n  mira: {}');
		const error = find(errors, 'unknown-key');

		// Same span as the error, which `addError` already aimed at the key node.
		expect(error?.fix).toMatchObject({
			col: error!.col,
			endCol: error!.endCol,
			line: error!.line
		});
	});

	it('offers nothing when no candidate is close enough to be a typo', () => {
		const {errors} = parseScene('id: a\nqqqqqqqq: 1');
		const error = find(errors, 'unknown-key');

		expect(error).toBeDefined();
		expect(error?.fix).toBeUndefined();
	});

	it('fixes an unknown layer while still naming the whole set', () => {
		const {errors} = parseScene('id: a\ncast:\n  mira: {layer: bak}');
		const error = find(errors, 'bad-layer');

		expect(error?.hint).toContain('Must be one of');
		expect(error?.fix).toMatchObject({replaces: 'bak', text: 'back'});
	});
});
