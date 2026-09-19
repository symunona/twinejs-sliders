/**
 * A link is stage STATE: set it on a beat and every later beat inherits it.
 *
 * That is the whole reason there is no beat-level `link:` construct — "same door, a
 * different destination per beat" is what an ordinary entity patch already means. These
 * tests pin that, and pin the two hand-written functions with no tripwire of their own
 * (`mergePatch`, `materialize`), where a missed key vanishes with no error anywhere.
 */

import {parseScene} from '@sliders/scene-schema';
import {applyScene} from '../apply-scene';
import {runBeats} from '../run-beats';
import {emptyStage} from '@sliders/scene-types';
import {cloneEntity, mergePatch} from '../stage';

function states(text: string) {
	const {scene} = parseScene(text);

	return runBeats(applyScene(emptyStage(), scene), scene.beats);
}

describe('link through the stage', () => {
	it('reaches a freshly declared entity (materialize)', () => {
		const [entry] = states(`
props:
  door: {at: 0.3, link: Cellar, highlight: gold}
`);

		expect(entry.entities.door.link).toEqual({to: 'Cellar'});
		expect(entry.entities.door.highlight).toBe('gold');
	});

	it('is inherited by every later beat until one changes it', () => {
		const stages = states(`
props:
  door: {at: 0.3, link: Hall}
cast:
  mira: {at: -0.3}
beats:
  - mira: "Look."
  - door: {link: Cellar}
  - mira: "Still there."
`);

		expect(stages[0].entities.door.link).toEqual({to: 'Hall'});
		expect(stages[1].entities.door.link).toEqual({to: 'Hall'});
		expect(stages[2].entities.door.link).toEqual({to: 'Cellar'});
		// The point of the whole feature: the next beat keeps the NEW destination.
		expect(stages[3].entities.door.link).toEqual({to: 'Cellar'});
	});

	it('is taken away by `link: ~`, which absence cannot say', () => {
		const stages = states(`
props:
  door: {at: 0.3, link: Hall}
beats:
  - door: {link: ~}
`);

		expect(stages[1].entities.door.link).toBeUndefined();
	});

	it('rides on the line that motivates it', () => {
		const stages = states(`
cast:
  mira: {at: -0.3}
props:
  door: {at: 0.3}
beats:
  - mira: {say: "Through there.", link: Cellar}
`);

		// The speaker is the entity the beat patches, so the CHARACTER becomes clickable.
		expect(stages[1].entities.mira.link).toEqual({to: 'Cellar'});
		expect(stages[1].entities.door.link).toBeUndefined();
	});
});

describe('mergePatch', () => {
	const base = {
		at: {x: 0, y: 0},
		flip: false,
		id: 'door',
		kind: 'prop' as const,
		link: {to: 'Hall'},
		opacity: 1,
		ref: 'door',
		scale: 1
	};

	it('leaves a link alone when the patch is silent about it', () => {
		expect(mergePatch(base, {at: {x: 0.5, y: 0}}).link).toEqual({to: 'Hall'});
	});

	it('clears on null and sets on a value', () => {
		expect(mergePatch(base, {link: null}).link).toBeUndefined();
		expect(mergePatch(base, {link: {to: 'Cellar'}}).link).toEqual({
			to: 'Cellar'
		});
	});
});

describe('cloneEntity', () => {
	it('copies the link, so one beat cannot edit the beat before it', () => {
		const entity = {
			at: {x: 0, y: 0},
			flip: false,
			id: 'door',
			kind: 'prop' as const,
			link: {to: 'Hall'},
			opacity: 1,
			ref: 'door',
			scale: 1
		};
		const copy = cloneEntity(entity);

		copy.link!.to = 'Cellar';
		expect(entity.link.to).toBe('Hall');
	});
});
