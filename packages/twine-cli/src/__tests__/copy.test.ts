/** @jest-environment node */

/**
 * `copy` is server-side, but everything it can get wrong is not: the ids it mints. That
 * lives in `cloneBody`, which is pure, so these run against a fixture body with no store,
 * no server and no fetch anywhere.
 */

import {buildSceneIndex} from '@sliders/scene-index';
import {cloneBody} from '../cmd/copy';
import type {StoryBody} from '../types';

const TAVERN = `mood: tense
--
[scene]
bg: tavern/night
cast:
  mira: {at: -0.4, pose: arms-crossed}
beats:
  - mira: "Sit down."
  - mark: tense
  - mira: "Or don't."
[continued]
The room goes quiet. [[stay]] [[go->Street]]
`;

const FIGHT = `[scene]
from: Tavern Night@tense   # pick it up at the mark
cast:
  mira: {pose: angry}
beats:
  - mira: "Then draw."
`;

const STREET = `[scene]
from: 'Tavern Night'
beats:
  - mira: "Rain, then."
`;

const ALLEY = `[scene]
from: somewhere-else
`;

/** A story whose scenes reference each other across passages. */
function fixture(): StoryBody {
	return {
		id: 'story-ep3',
		ifid: 'IFID-EP3',
		name: 'Episode 3',
		startPassage: 'p-tavern',
		storyFormat: 'Sliders',
		storyFormatVersion: '0.1.0',
		selected: true,
		sync: true,
		zoom: 1,
		passages: [
			{
				id: 'p-tavern',
				name: 'Tavern Night',
				tags: ['scene'],
				text: TAVERN,
				left: 25,
				top: 50,
				height: 100,
				width: 100
			},
			{
				id: 'p-fight',
				name: 'Tavern Fight',
				tags: [],
				text: FIGHT,
				left: 175,
				top: 50,
				height: 100,
				width: 100
			},
			{
				id: 'p-street',
				name: 'Street',
				tags: ['outdoor'],
				text: STREET,
				left: 25,
				top: 200,
				height: 100,
				width: 100
			},
			{
				id: 'p-alley',
				name: 'Alley',
				tags: [],
				text: ALLEY,
				left: 175,
				top: 200,
				height: 100,
				width: 100
			}
		]
	};
}

/** Predictable ids, so a test can say which one it means. */
function counter(): () => string {
	let n = 0;

	return () => `new-${++n}`;
}

describe('cloneBody', () => {
	it('mints a new story id, a new ifid and a new id for every passage', () => {
		const body = fixture();
		const clone = cloneBody(body, {name: 'Episode 4', uuid: counter()});

		expect(clone.body.id).toBe('new-1');
		expect(clone.body.id).not.toBe(body.id);
		expect(clone.body.ifid).toBe('NEW-6');
		expect(clone.body.ifid).not.toBe(body.ifid);
		expect(clone.body.name).toBe('Episode 4');

		const ids = clone.body.passages.map(passage => passage.id);

		expect(ids).toEqual(['new-2', 'new-3', 'new-4', 'new-5']);
		expect(new Set(ids).size).toBe(ids.length);

		for (const passage of clone.body.passages) {
			expect(passage.story).toBe(clone.body.id);
		}
	});

	it('keeps names, tags and positions, and moves startPassage with its passage', () => {
		const body = fixture();
		const clone = cloneBody(body, {name: 'Episode 4', uuid: counter()});

		expect(clone.body.passages.map(passage => passage.name)).toEqual([
			'Tavern Night',
			'Tavern Fight',
			'Street',
			'Alley'
		]);
		expect(clone.body.passages[2].tags).toEqual(['outdoor']);
		expect(clone.body.passages[0].left).toBe(25);
		expect(clone.body.passages[1].top).toBe(50);
		expect(clone.body.startPassage).toBe(clone.body.passages[0].id);
		expect(clone.body.storyFormat).toBe('Sliders');
	});

	it('drops the editor-local props and leaves the source body alone', () => {
		const body = fixture();
		const clone = cloneBody(body, {name: 'Episode 4', uuid: counter()});

		expect('sync' in clone.body).toBe(false);
		expect('selected' in clone.body).toBe(false);
		expect(body.id).toBe('story-ep3');
		expect(body.passages[0].id).toBe('p-tavern');
		expect(body.passages[0].text).toBe(TAVERN);
	});

	it('copies passage text byte for byte', () => {
		const clone = cloneBody(fixture(), {name: 'Episode 4', uuid: counter()});

		expect(clone.body.passages[0].text).toBe(TAVERN);
		expect(clone.body.passages[1].text).toBe(FIGHT);
		expect(clone.body.passages[2].text).toBe(STREET);
		expect(clone.body.passages[3].text).toBe(ALLEY);
	});

	it('keeps every from: resolving, because it names a passage and names survive', () => {
		const clone = cloneBody(fixture(), {name: 'Episode 4', uuid: counter()});
		const after = buildSceneIndex(
			clone.body.passages.map(passage => ({
				name: passage.name,
				text: passage.text
			}))
		);

		expect(after.resolve('Tavern Fight@enter')?.entities.mira.pose).toBe('angry');
		expect(after.resolve('Street')).toBeDefined();
		expect(after.errors.map(error => error.code)).toEqual(['unknown-from']);
	});
});
