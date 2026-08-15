/**
 * @jest-environment-options {"customExportConditions": ["node"]}
 */
import {LAYER_BASELINE} from '@sliders/scene-types';
import type {SceneError} from '@sliders/scene-types';
import {buildSceneIndex, splitSceneRef} from '../index';

function passage(name: string, block: string) {
	return {name, text: `[scene]\n${block}`};
}

function codes(errors: SceneError[]): string[] {
	return errors.map(e => e.code);
}

const TAVERN = `id: tavern-night
bg: tavern/night
cast:
  mira:  {at: -0.4, frame: arms-crossed}
  joren: {at: 0.35, frame: idle}
beats:
  - mira: "You shouldn't have come back."
  - mira: {frame: angry, at: -0.25, say: "Get out."}
  - mark: tense
  - joren: {at: 0.5}
`;

const FIGHT = `id: tavern-fight
from: tavern-night@tense
cast:
  mira: {frame: furious}
beats:
  - mira: "Then draw."
`;

const STREET = `id: street
from: tavern-night
cast:
  joren: ~
`;

describe('buildSceneIndex', () => {
	describe('a healthy three-passage story', () => {
		const index = buildSceneIndex([
			passage('Tavern - Arrival', TAVERN),
			passage('Tavern - Fight', FIGHT),
			passage('Street', STREET)
		]);

		it('reports no errors', () => {
			expect(index.errors).toEqual([]);
		});

		it('indexes every scene by id, with its passage', () => {
			expect([...index.scenes.keys()].sort()).toEqual([
				'street',
				'tavern-fight',
				'tavern-night'
			]);
			expect(index.scenes.get('tavern-night')?.passage).toBe('Tavern - Arrival');
		});

		it('compiles one state per beat, plus the entry state', () => {
			const entry = index.scenes.get('tavern-night');

			expect(entry?.states).toHaveLength(5);
		});

		it('records marks', () => {
			expect(index.scenes.get('tavern-night')?.marks.get('tense')).toBe(3);
		});

		it('resolves a bare id to the exit state', () => {
			const exit = index.resolve('tavern-night');

			// joren moved on the last beat, so exit is not the same as @tense.
			expect(exit?.entities.joren.at).toEqual({x: 0.5, y: LAYER_BASELINE});
		});

		it('resolves @enter to the state before any beat', () => {
			expect(index.resolve('tavern-night@enter')?.entities.mira).toMatchObject({
				at: {x: -0.4, y: LAYER_BASELINE},
				frame: 'arms-crossed'
			});
		});

		it('resolves @mark to the marked state', () => {
			const marked = index.resolve('tavern-night@tense');

			expect(marked?.entities.mira).toMatchObject({
				at: {x: -0.25, y: LAYER_BASELINE},
				frame: 'angry'
			});
			expect(marked?.entities.joren.at).toEqual({x: 0.35, y: LAYER_BASELINE});
		});

		it('inherits from a mark rather than from the exit state', () => {
			const fight = index.resolve('tavern-fight@enter');

			// joren is at his @tense position, not his exit position.
			expect(fight?.entities.joren.at).toEqual({x: 0.35, y: LAYER_BASELINE});
			expect(fight?.entities.mira.frame).toBe('furious');
			// And the patch inherited everything it did not mention.
			expect(fight?.bg).toBe('tavern/night');
			expect(fight?.entities.mira.at).toEqual({x: -0.25, y: LAYER_BASELINE});
		});

		it('honours a null entity as a removal across passages', () => {
			const street = index.resolve('street');

			expect(street?.entities.joren).toBeUndefined();
			expect(street?.entities.mira).toBeDefined();
		});

		it('returns undefined for a scene it does not know', () => {
			expect(index.resolve('nowhere')).toBeUndefined();
			expect(index.resolve('tavern-night@nope')).toBeUndefined();
		});

		it('resolves regardless of the order passages arrive in', () => {
			const reversed = buildSceneIndex([
				passage('Street', STREET),
				passage('Tavern - Fight', FIGHT),
				passage('Tavern - Arrival', TAVERN)
			]);

			expect(reversed.errors).toEqual([]);
			expect(reversed.resolve('tavern-fight@enter')).toEqual(
				index.resolve('tavern-fight@enter')
			);
		});
	});

	describe('passages without scenes', () => {
		it('skips passages with no [scene] block', () => {
			const index = buildSceneIndex([
				{name: 'Prose', text: 'Just some Chapbook text.'},
				passage('Tavern', TAVERN)
			]);

			expect(index.errors).toEqual([]);
			expect(index.scenes.size).toBe(1);
		});

		it('does not index an anonymous scene, but still reports its errors', () => {
			const index = buildSceneIndex([
				passage('Anon', 'char: 1\ncast:\n  mira: {at: 0}\n')
			]);

			expect(index.scenes.size).toBe(0);
			expect(codes(index.errors)).toEqual(['unknown-key']);
		});

		it('handles an empty passage list', () => {
			const index = buildSceneIndex([]);

			expect(index.scenes.size).toBe(0);
			expect(index.errors).toEqual([]);
		});
	});

	describe('parse errors', () => {
		it('offsets error lines back onto the real passage', () => {
			const index = buildSceneIndex([
				{
					name: 'Tavern',
					text: 'mood: tense\n--\n[scene]\nid: a\ncast:\n  mira: {layer: nope}\n'
				}
			]);

			expect(index.errors).toHaveLength(1);
			expect(index.errors[0].code).toBe('bad-layer');
			// Block line 3 -> passage line 6.
			expect(index.errors[0].line).toBe(6);
		});

		it('names the passage in the message', () => {
			const index = buildSceneIndex([passage('Tavern', 'id: a\nchar: 1\n')]);

			expect(index.errors[0].message).toMatch(/^Tavern: /);
		});

		it('still indexes a scene that had errors', () => {
			const index = buildSceneIndex([
				passage('Tavern', 'id: a\ncast:\n  mira: {layer: nope}\n')
			]);

			expect(index.scenes.has('a')).toBe(true);
			expect(index.resolve('a')?.entities.mira.layer).toBe('mid');
		});
	});

	describe('duplicate ids', () => {
		const index = buildSceneIndex([
			passage('One', 'id: tavern\nbg: a\n'),
			passage('Two', 'id: tavern\nbg: b\n')
		]);

		it('reports the second one', () => {
			expect(codes(index.errors)).toEqual(['dupe-scene-id']);
			expect(index.errors[0].message).toContain("'One'");
			expect(index.errors[0].severity).toBe('error');
		});

		it('points at the offending id: line', () => {
			expect(index.errors[0].line).toBe(2);
			expect(index.errors[0].col).toBe(1);
		});

		it('keeps the first definition', () => {
			expect(index.scenes.get('tavern')?.passage).toBe('One');
			expect(index.resolve('tavern')?.bg).toBe('a');
		});
	});

	describe('unknown from:', () => {
		it('reports an unknown scene id and falls back to an empty stage', () => {
			const index = buildSceneIndex([
				passage('Fight', 'id: fight\nfrom: nowhere\ncast:\n  mira: {at: 0}\n')
			]);

			expect(codes(index.errors)).toEqual(['unknown-from']);
			expect(index.errors[0].line).toBe(3);
			expect(index.scenes.has('fight')).toBe(true);
			expect(Object.keys(index.resolve('fight')?.entities ?? {})).toEqual(['mira']);
		});

		it('reports an unknown mark on a known scene', () => {
			const index = buildSceneIndex([
				passage('Tavern', TAVERN),
				passage('Fight', 'id: fight\nfrom: tavern-night@calm\n')
			]);

			expect(codes(index.errors)).toEqual(['unknown-from']);
			expect(index.errors[0].message).toContain('calm');
			expect(index.errors[0].hint).toContain('mark: calm');
		});

		it('accepts @enter as a built-in mark', () => {
			const index = buildSceneIndex([
				passage('Tavern', TAVERN),
				passage('Fight', 'id: fight\nfrom: tavern-night@enter\n')
			]);

			expect(index.errors).toEqual([]);
			expect(index.resolve('fight')?.entities.mira.frame).toBe('arms-crossed');
		});
	});

	describe('cycles', () => {
		it('reports a two-scene cycle instead of hanging', () => {
			const index = buildSceneIndex([
				passage('A', 'id: a\nfrom: b\n'),
				passage('B', 'id: b\nfrom: a\n')
			]);

			expect(codes(index.errors)).toEqual(['from-cycle', 'from-cycle']);
			expect(index.errors[0].message).toContain('->');
			expect(index.scenes.size).toBe(2);
		});

		it('reports a self-cycle once', () => {
			const index = buildSceneIndex([passage('A', 'id: a\nfrom: a\n')]);

			expect(codes(index.errors)).toEqual(['from-cycle']);
			expect(index.errors[0].line).toBe(3);
		});

		it('reports a three-scene cycle once per scene', () => {
			const index = buildSceneIndex([
				passage('A', 'id: a\nfrom: b\n'),
				passage('B', 'id: b\nfrom: c\n'),
				passage('C', 'id: c\nfrom: a\n')
			]);

			expect(codes(index.errors)).toEqual([
				'from-cycle',
				'from-cycle',
				'from-cycle'
			]);
		});

		it('still gives every scene in a cycle a best-effort state', () => {
			const index = buildSceneIndex([
				passage('A', 'id: a\nfrom: b\ncast:\n  mira: {at: 0}\n'),
				passage('B', 'id: b\nfrom: a\n')
			]);

			expect(index.resolve('a')).toBeDefined();
			expect(index.resolve('b')).toBeDefined();
		});

		it('does not mistake a diamond for a cycle', () => {
			const index = buildSceneIndex([
				passage('Root', 'id: root\nbg: hall\n'),
				passage('Left', 'id: left\nfrom: root\n'),
				passage('Right', 'id: right\nfrom: root\n'),
				passage('Join', 'id: join\nfrom: left\n')
			]);

			expect(index.errors).toEqual([]);
			expect(index.resolve('join')?.bg).toBe('hall');
		});

		it('resolves a scene whose parent is in a cycle, without looping', () => {
			const index = buildSceneIndex([
				passage('A', 'id: a\nfrom: b\n'),
				passage('B', 'id: b\nfrom: a\nbg: hall\n'),
				passage('C', 'id: c\nfrom: b\n')
			]);

			expect(codes(index.errors)).toEqual(['from-cycle', 'from-cycle']);
			expect(index.resolve('c')?.bg).toBe('hall');
		});
	});
});

describe('splitSceneRef', () => {
	it('splits an id from its mark', () => {
		expect(splitSceneRef('tavern-night@tense')).toEqual({
			id: 'tavern-night',
			mark: 'tense'
		});
	});

	it('leaves a bare id alone', () => {
		expect(splitSceneRef('tavern-night')).toEqual({id: 'tavern-night'});
	});

	it('ignores a trailing @', () => {
		expect(splitSceneRef('tavern-night@')).toEqual({
			id: 'tavern-night',
			mark: undefined
		});
	});
});
