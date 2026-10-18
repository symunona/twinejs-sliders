/**
 * Several entities in one beat (spec 02, "Several at once"): the first key is the beat's,
 * every other entity is a `with:` part, `dur`/`ease`/`sfx`/`bg`/`music` beside them ride
 * on the beat.
 */

import {beatLines, beatParts} from '@sliders/scene-types';
import {parseScene} from '../parse-scene';

const CAST = 'cast:\n  mira: {at: 0}\n  joren: {at: 0.5}\n';

function parse(beats: string) {
	return parseScene(`${CAST}beats:\n${beats}`);
}

describe('multi-entity beat', () => {
	it('moves two entities in one beat, each on its own clock', () => {
		const {errors, scene} = parse(
			'  - mira: {at: 0.3, dur: 2}\n    joren: {at: -0.3, dur: 1, ease: ease_out}\n'
		);

		expect(errors).toEqual([]);
		expect(scene.beats).toHaveLength(1);

		const beat = scene.beats[0];

		expect(beat.kind).toBe('set');
		expect(beat.dur).toBe(2);
		expect(beat.ownDur).toBe(true);
		expect(beat.with).toEqual([
			{dur: 1, ease: 'ease_out', patch: {at: {x: -0.3, y: -0.85}}, who: 'joren'}
		]);
		expect(beatParts(beat).map(part => part.who)).toEqual(['mira', 'joren']);
	});

	it('lets two people talk at once', () => {
		const {errors, scene} = parse('  - mira: "Now!"\n    joren: "Now!"\n');

		expect(errors).toEqual([]);
		expect(beatLines(scene.beats[0])).toEqual([
			{text: 'Now!', who: 'mira'},
			{text: 'Now!', who: 'joren'}
		]);
	});

	it('puts the speaker first when the first key only moves', () => {
		const {errors, scene} = parse('  - mira: {at: 0.3}\n    joren: "Look."\n');

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toMatchObject({kind: 'say', text: 'Look.', who: 'joren'});
		expect(scene.beats[0].with?.[0]).toMatchObject({who: 'mira'});
	});

	it('reads dur, ease and sfx beside the entities as the beat’s', () => {
		const {errors, scene} = parse(
			'  - mira: {at: 0.3}\n    joren: {at: -0.3}\n    dur: 1.5\n    ease: linear\n    sfx: door\n'
		);

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toMatchObject({dur: 1.5, ease: 'linear', sfx: {id: 'door'}});
	});

	it('turns `- sfx:` + an entity into the entity’s beat with a sound on it', () => {
		const {errors, scene} = parse('  - sfx: door\n    mira: "What?"\n');

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toMatchObject({kind: 'say', sfx: {id: 'door'}, who: 'mira'});
	});

	it('moves people during a wait, refuses a line on one', () => {
		const ok = parse('  - wait: 2\n    mira: {at: 0.3}\n');

		expect(ok.errors).toEqual([]);
		expect(ok.scene.beats[0]).toMatchObject({kind: 'wait', seconds: 2});
		expect(ok.scene.beats[0].with).toHaveLength(1);

		const bad = parse('  - wait: 2\n    mira: "Hm."\n');

		expect(bad.errors.map(e => e.message)).toContain(
			'A line cannot ride on wait:. Give it a beat of its own.'
		);
	});

	it('shows narration and a bubble together', () => {
		const {errors, scene} = parse('  - box: "Later."\n    mira: "Yawn."\n');

		expect(errors).toEqual([]);
		expect(beatLines(scene.beats[0])).toEqual([
			{text: 'Later.'},
			{text: 'Yawn.', who: 'mira'}
		]);
	});

	it('still refuses two commands', () => {
		const {errors} = parse('  - wait: 1\n    mark: x\n');

		expect(errors.map(e => e.message)).toContain(
			'A beat has one wait:. Split this into two beats.'
		);
	});

	it('still names the missing indent', () => {
		const {errors} = parse('  - mira:\n    say: "Hi"\n    at: 0.3\n');

		expect(errors[0].message).toMatch(/^Indent these under `mira:`/);
	});

	it('refuses two dur: values', () => {
		const {errors} = parse('  - mira: {at: 0.3, dur: 1}\n    joren: {at: 0}\n    dur: 2\n');

		expect(errors.map(e => e.message)).toContain('This beat has two dur: values.');
	});
});
