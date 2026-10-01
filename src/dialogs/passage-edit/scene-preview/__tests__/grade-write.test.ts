/**
 * The Grade popover's writes: what lands where, and as how few keys.
 *
 * `grade:` MERGES on a beat, so a beat says only what differs from the stage before it —
 * and the text a write produces, re-parsed, must draw exactly the grade the author set.
 */

import {extractSceneBlock} from '@sliders/scene-index';
import {applyEdit} from '@sliders/scene-edit';
import type {EntityGrade} from '@sliders/scene-types';
import {gradeTarget, gradeWrite} from '../grade-write';
import {parseSceneText} from '../use-scene-parse';
import {buildWriteEdit} from '../use-scene-writer';

const passage = [
	'[scene]',
	'cast:',
	'  hero: {at: 0.3, grade: {warmth: 30, brightness: -15}}',
	'  mira: {at: -0.3}',
	'beats:',
	'  - hero: {grade: {warmth: 60, hue: -10}}',
	'  - mira: "Hello."',
	'  - hero: "Hi."'
].join('\n');

/** Write `next` for hero at scrubber `beat`, re-parse, and hand back both. */
function roundTrip(text: string, beat: number, next: EntityGrade | undefined) {
	const parse = parseSceneText(text);
	const scene = parse.result!.scene;
	const hero = parse.states[beat].entities.hero;
	const write = gradeWrite({beat, entity: hero, next, scene, states: parse.states});
	const block = extractSceneBlock(text)!;
	const edit = buildWriteEdit(
		{beat, blockOffset: block.offset, blockText: block.text, scene},
		write
	);
	const after = edit
		? text.slice(0, block.offset) + applyEdit(block.text, edit) + text.slice(block.offset + block.text.length)
		: text;

	return {after, reparsed: parseSceneText(after), write};
}

describe('gradeTarget', () => {
	it('names the entry, an owned beat, and somebody else’s beat', () => {
		const scene = parseSceneText(passage).result!.scene;
		const hero = {id: 'hero', kind: 'cast' as const};

		expect(gradeTarget(scene, 0, hero)).toBe('entry');
		expect(gradeTarget(scene, 1, hero)).toBe('beat');
		expect(gradeTarget(scene, 2, hero)).toBe('newBeat');
		expect(gradeTarget(scene, 3, hero)).toBe('beat');
	});
});

describe('gradeWrite', () => {
	it('writes the whole grade into the entry at scrubber 0, rest keys left out', () => {
		const {after, reparsed, write} = roundTrip(passage, 0, {
			brightness: -15,
			saturation: -20,
			warmth: 30
		});

		expect(write.value).toEqual({brightness: -15, saturation: -20, warmth: 30});
		expect(after).toContain(
			'  hero: {at: 0.3, grade: {brightness: -15, warmth: 30, saturation: -20}}'
		);
		expect(reparsed.states[0].entities.hero.grade).toEqual({
			brightness: -15,
			saturation: -20,
			warmth: 30
		});
	});

	it('removes the entry grade when everything is back at rest', () => {
		const {after, write} = roundTrip(passage, 0, undefined);

		expect(write.value).toBeUndefined();
		expect(after).toContain('  hero: {at: 0.3}');
	});

	it('writes only what differs from the stage before an owned beat', () => {
		const {after, reparsed, write} = roundTrip(passage, 1, {
			brightness: -15,
			warmth: 30,
			hue: 20
		});

		// Warmth back to the scene's own 30 is said out loud: the beat line had 60.
		expect(write.value).toEqual({hue: 20});
		expect(after).toContain('  - hero: {grade: {hue: 20}}');
		expect(reparsed.states[1].entities.hero.grade).toEqual({
			brightness: -15,
			hue: 20,
			warmth: 30
		});
	});

	it('says a reset to rest on a beat, because a beat inherits what it leaves out', () => {
		const {reparsed, write} = roundTrip(passage, 1, {warmth: 60, hue: -10});

		expect(write.value).toEqual({brightness: 0, hue: -10, warmth: 60});
		expect(reparsed.states[1].entities.hero.grade).toEqual({hue: -10, warmth: 60});
	});

	it('removes the beat grade when the beat matches the stage before it', () => {
		const {after, write} = roundTrip(passage, 1, {brightness: -15, warmth: 30});

		expect(write.value).toBeUndefined();
		expect(after).toContain('  - hero: {}');
	});

	it('promotes a dialogue line it owns', () => {
		const {after, reparsed} = roundTrip(passage, 3, {
			brightness: -15,
			hue: -10,
			warmth: 80
		});

		expect(after).toContain('  - hero: {say: "Hi.", grade: {warmth: 80}}');
		expect(reparsed.states[3].entities.hero.grade).toEqual({
			brightness: -15,
			hue: -10,
			warmth: 80
		});
	});

	it('gives itself a new beat after somebody else’s', () => {
		const {reparsed, write} = roundTrip(passage, 2, {
			brightness: -15,
			hue: -10,
			warmth: 60,
			tint: 5
		});

		expect(write.value).toEqual({tint: 5});
		expect(reparsed.result!.scene.beats).toHaveLength(4);
		expect(reparsed.states[3].entities.hero.grade).toEqual({
			brightness: -15,
			hue: -10,
			tint: 5,
			warmth: 60
		});
	});

	it('in a from: scene, says a key going back to rest in the entry too', () => {
		const patch = [
			'[scene]',
			'from: Elsewhere',
			'cast:',
			'  hero: {grade: {warmth: 30, hue: 5}}'
		].join('\n');
		const parse = parseSceneText(patch);
		const write = gradeWrite({
			beat: 0,
			entity: parse.states[0].entities.hero,
			next: {hue: 5},
			scene: parse.result!.scene,
			states: parse.states
		});

		expect(write.value).toEqual({hue: 5, warmth: 0});
	});
});
