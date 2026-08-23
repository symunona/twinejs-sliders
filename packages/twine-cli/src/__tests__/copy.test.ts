/** @jest-environment node */

/**
 * `copy` is server-side, but everything it can get wrong is not: the ids it mints and the
 * `--reid` rewrite. Both live in `cloneBody`, which is pure, so these run against a fixture
 * body with no store, no server and no fetch anywhere.
 */

import {buildSceneIndex} from '@sliders/scene-index';
import {cloneBody} from '../cmd/copy';
import type {StoryBody} from '../types';

const TAVERN = `mood: tense
--
[scene]
id: tavern-night        # the scene the others hang off
bg: tavern/night
cast:
  mira: {at: -0.4, frame: arms-crossed}
beats:
  - mira: "Sit down."
  - mark: tense
  - mira: "Or don't."
[continued]
The room goes quiet. [[stay]] [[go->Street]]
`;

const FIGHT = `[scene]
id: tavern-fight
from: tavern-night@tense   # pick it up at the mark
cast:
  mira: {frame: angry}
beats:
  - mira: "Then draw."
`;

const STREET = `[scene]
id: street
from: 'tavern-night'
beats:
  - mira: "Rain, then."
`;

const ALLEY = `[scene]
id: alley
from: somewhere-else
`;

/** A story whose scenes reference each other across passages — the case `--reid` breaks. */
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

	it('copies passage text byte for byte when there is no --reid', () => {
		const clone = cloneBody(fixture(), {name: 'Episode 4', uuid: counter()});

		expect(clone.body.passages[0].text).toBe(TAVERN);
		expect(clone.body.passages[1].text).toBe(FIGHT);
		expect(clone.body.passages[2].text).toBe(STREET);
		expect(clone.body.passages[3].text).toBe(ALLEY);
		expect(clone.sceneIds.size).toBe(0);
		expect(clone.unrewritten).toEqual([]);
	});

	it('--reid rewrites id:, from: and the @mark together, keeping the rest of the line', () => {
		const clone = cloneBody(fixture(), {
			name: 'Episode 4',
			reid: 'ep4-',
			uuid: counter()
		});

		expect(clone.body.passages[0].text).toBe(
			TAVERN.replace(
				'id: tavern-night        # the scene the others hang off',
				'id: ep4-tavern-night        # the scene the others hang off'
			)
		);
		expect(clone.body.passages[1].text).toBe(
			FIGHT.replace('id: tavern-fight', 'id: ep4-tavern-fight').replace(
				'from: tavern-night@tense   # pick it up at the mark',
				'from: ep4-tavern-night@tense   # pick it up at the mark'
			)
		);
		// The quoting the author chose survives too.
		expect(clone.body.passages[2].text).toBe(
			STREET.replace('id: street', 'id: ep4-street').replace(
				"from: 'tavern-night'",
				"from: 'ep4-tavern-night'"
			)
		);
		expect(Object.fromEntries(clone.sceneIds)).toEqual({
			'tavern-night': 'ep4-tavern-night',
			'tavern-fight': 'ep4-tavern-fight',
			street: 'ep4-street',
			alley: 'ep4-alley'
		});
	});

	it('--reid leaves everything outside the scene block untouched', () => {
		const clone = cloneBody(fixture(), {
			name: 'Episode 4',
			reid: 'ep4-',
			uuid: counter()
		});

		expect(clone.body.passages[0].text).toContain('mood: tense\n--\n[scene]');
		expect(clone.body.passages[0].text).toContain(
			'[continued]\nThe room goes quiet. [[stay]] [[go->Street]]\n'
		);
	});

	it('a from: pointing at a scene in another passage still resolves after --reid', () => {
		const before = buildSceneIndex(
			fixture().passages.map(passage => ({name: passage.name, text: passage.text}))
		);

		// The fixture is a story that resolves to begin with, or the assertion below would
		// prove nothing.
		expect(before.scenes.has('tavern-fight')).toBe(true);
		expect(before.resolve('tavern-night@tense')).toBeDefined();

		const clone = cloneBody(fixture(), {
			name: 'Episode 4',
			reid: 'ep4-',
			uuid: counter()
		});
		const after = buildSceneIndex(
			clone.body.passages.map(passage => ({
				name: passage.name,
				text: passage.text
			}))
		);

		expect(after.scenes.has('ep4-tavern-fight')).toBe(true);
		expect(after.scenes.get('ep4-tavern-fight')?.scene.from).toBe(
			'ep4-tavern-night@tense'
		);
		expect(after.scenes.get('ep4-street')?.scene.from).toBe('ep4-tavern-night');
		expect(after.resolve('ep4-tavern-night@tense')).toBeDefined();
		expect(after.resolve('ep4-tavern-fight')).toBeDefined();

		// Nothing still points at an id that no longer exists.
		expect(
			after.errors.filter(error => /(^|\W)tavern-night(\W|$)/.test(error.message))
		).toEqual([]);
	});

	it('reports a reference it could not rewrite, and leaves that one as it was', () => {
		const clone = cloneBody(fixture(), {
			name: 'Episode 4',
			reid: 'ep4-',
			uuid: counter()
		});

		expect(clone.unrewritten).toEqual([
			{
				passage: 'Alley',
				line: 3,
				ref: 'somewhere-else',
				reason: 'no scene in this story has id "somewhere-else" — left as it was'
			}
		]);
		expect(clone.body.passages[3].text).toBe(
			ALLEY.replace('id: alley', 'id: ep4-alley')
		);
	});
});
