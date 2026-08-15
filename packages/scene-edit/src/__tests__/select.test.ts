/**
 * @jest-environment-options {"customExportConditions": ["node"]}
 */
import {FIXTURE, PATCH_FIXTURE, lineOf} from '../__fixtures__/fixture';
import {entityAtLine, entityLines} from '../index';

describe('entityLines', () => {
	it('spans one line for a flow entity', () => {
		const mira = lineOf(FIXTURE, '  mira:  {at: -0.4');

		expect(entityLines(FIXTURE, {id: 'mira', kind: 'cast'})).toEqual({
			end: mira,
			start: mira
		});
	});

	it('spans every line of a block entity, and no more', () => {
		expect(entityLines(FIXTURE, {id: 'joren', kind: 'cast'})).toEqual({
			end: lineOf(FIXTURE, '    layer: back'),
			start: lineOf(FIXTURE, '  joren:')
		});
	});

	it('spans the beat line for a beat target', () => {
		const beat = lineOf(FIXTURE, '  - mira: {frame: angry');

		expect(entityLines(FIXTURE, {beat: 2, id: 'mira', kind: 'cast'})).toEqual({
			end: beat,
			start: beat
		});
	});

	it('returns undefined for an entity or beat that is not there', () => {
		expect(entityLines(FIXTURE, {id: 'nobody', kind: 'cast'})).toBeUndefined();
		expect(
			entityLines(FIXTURE, {beat: 1, id: 'mira', kind: 'cast'})
		).toBeUndefined();
		expect(
			entityLines('just a string', {id: 'a', kind: 'cast'})
		).toBeUndefined();
	});
});

describe('entityAtLine', () => {
	it('finds a flow entity', () => {
		expect(
			entityAtLine(FIXTURE, lineOf(FIXTURE, '  mira:  {at: -0.4'))
		).toEqual({id: 'mira', kind: 'cast'});
	});

	it('finds a block entity from any of its lines', () => {
		for (const needle of ['  joren:', '    at: 0.35', '    layer: back']) {
			expect(entityAtLine(FIXTURE, lineOf(FIXTURE, needle))).toEqual({
				id: 'joren',
				kind: 'cast'
			});
		}
	});

	it('finds the beat a caret sits in', () => {
		expect(
			entityAtLine(FIXTURE, lineOf(FIXTURE, '  - mira: {frame: angry'))
		).toEqual({beat: 2, id: 'mira', kind: 'cast'});
		expect(
			entityAtLine(FIXTURE, lineOf(FIXTURE, "  - joren: 'And yet.'"))
		).toEqual({beat: 1, id: 'joren', kind: 'cast'});
	});

	it('classifies a beat speaker by the props: map, defaulting to cast', () => {
		expect(
			entityAtLine(PATCH_FIXTURE, lineOf(PATCH_FIXTURE, '  candle:'))
		).toEqual({id: 'candle', kind: 'prop'});
	});

	it('says nothing for command beats, map keys and comments', () => {
		for (const needle of [
			'  - wait: 0.5',
			'  - mark: tense',
			'cast:',
			'  # Mira is already inside',
			'fx: [rain@0.6]',
			'  stay: {to: Tavern Fight'
		]) {
			expect(entityAtLine(FIXTURE, lineOf(FIXTURE, needle))).toBeUndefined();
		}
	});

	it('says nothing for a line off the end or before the start', () => {
		expect(entityAtLine(FIXTURE, 0)).toBeUndefined();
		expect(entityAtLine(FIXTURE, 9999)).toBeUndefined();
	});
});

describe('entityAtLine and entityLines round-trip', () => {
	it('every line an entity claims maps back to that same entity', () => {
		for (const text of [FIXTURE, PATCH_FIXTURE]) {
			const lines = text.split('\n').length;

			for (let line = 1; line <= lines; line++) {
				const target = entityAtLine(text, line);

				if (!target) {
					continue;
				}

				const span = entityLines(text, target);

				expect(span).toBeDefined();
				expect(line).toBeGreaterThanOrEqual(span!.start);
				expect(line).toBeLessThanOrEqual(span!.end);

				// And going the other way lands on the same target again.
				expect(entityAtLine(text, span!.start)).toEqual(target);
			}
		}
	});
});
