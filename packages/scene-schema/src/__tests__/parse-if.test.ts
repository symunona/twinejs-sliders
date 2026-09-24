/**
 * `if:` on an entity and on a beat. The parser only records and checks the condition; the
 * player decides (`gate-scene.ts`), so these assert what reaches it.
 */

import {parseScene} from '../parse-scene';

describe('entity if:', () => {
	it('is kept apart from the stage patch', () => {
		const {errors, scene, conditionSpans} = parseScene(`
props:
  drone: {at: [0.1, -0.9], if: passage.visits == 1}
`);

		expect(errors).toEqual([]);
		expect(scene.entityIfs).toEqual({drone: 'passage.visits == 1'});
		expect(scene.entities.drone).not.toHaveProperty('if');
		expect(conditionSpans).toEqual([
			expect.objectContaining({if: 'passage.visits == 1', line: 3, what: "'drone'"})
		]);
	});

	it('reports a condition that does not parse, and keeps it', () => {
		const {errors, scene} = parseScene(`
cast:
  bob: {at: 0, if: has_key and}
`);

		expect(errors.map(error => error.message)).toEqual([
			'if: The condition stops before it is finished.'
		]);
		expect(scene.entityIfs).toEqual({bob: 'has_key and'});
	});

	it('explains the YAML tag a bare ! turns into', () => {
		const {errors} = parseScene(`
props:
  drone: {at: 0, if: !visited}
`);

		expect(errors[0].hint).toBe(
			'A leading ! starts a YAML tag. For a condition, write "!visited" in quotes, or not visited.'
		);
	});
});

describe('beat if:', () => {
	it('gates a speaker beat from inside its map', () => {
		const {errors, scene} = parseScene(`
beats:
  - bob: {say: "Back again.", if: passage.visits > 1}
`);

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toMatchObject({if: 'passage.visits > 1', kind: 'say'});
		expect(scene.beats[0]).not.toHaveProperty('patch');
	});

	it('gates any beat from beside it', () => {
		const {errors, scene} = parseScene(`
beats:
  - wait: 1
    if: tense
  - {box: "Hush.", if: not tense}
  - bob: "Hi."
    if: friendly
`);

		expect(errors).toEqual([]);
		expect(scene.beats.map(beat => [beat.kind, beat.if])).toEqual([
			['wait', 'tense'],
			['box', 'not tense'],
			['say', 'friendly']
		]);
	});

	it('gates a box beat from inside its map', () => {
		const {errors, scene, conditionSpans} = parseScene(`
beats:
  - box: {text: "Hush.", if: tense}
`);

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toMatchObject({if: 'tense', kind: 'box', text: 'Hush.'});
		expect(conditionSpans).toEqual([
			expect.objectContaining({if: 'tense', line: 3, what: 'Beat 1'})
		]);
	});

	it('refuses a box with an if: inside and one beside', () => {
		const {errors} = parseScene(`
beats:
  - box: {text: "Hush.", if: a}
    if: b
`);

		expect(errors.map(error => error.message)).toEqual([
			'This beat has two if: conditions.'
		]);
	});

	it('refuses two conditions on one beat', () => {
		const {errors} = parseScene(`
beats:
  - bob: {say: "Hi.", if: a}
    if: b
`);

		expect(errors.map(error => error.message)).toEqual([
			'This beat has two if: conditions.'
		]);
	});

	it('says an if: on its own gates nothing', () => {
		const {errors, scene} = parseScene(`
beats:
  - if: a
`);

		expect(errors.map(error => error.message)).toEqual(['This if: gates nothing.']);
		expect(scene.beats).toEqual([]);
	});

	it('refuses the invented $ syntax with a way out', () => {
		const {errors} = parseScene(`
beats:
  - bob: {say: "Hi.", if: "!$visited"}
`);

		expect(errors[0]).toMatchObject({
			hint: "Write 'visited', without the $.",
			message: 'if: Conditions name variables without a $.'
		});
	});
});

describe('link if:', () => {
	it('is checked with the same grammar', () => {
		const {errors} = parseScene(`
links:
  go: {to: Street, if: coins >=}
`);

		expect(errors.map(error => error.message)).toEqual([
			'link if: The condition stops before it is finished.'
		]);
	});
});
