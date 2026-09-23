import {Character} from '@sliders/scene-types';
import {anchorNames, migrateCharacter, newPoseAnchors} from '../characters';

/** A character in the shape libraries written before anchors moved onto poses. */
function legacy(overrides: Record<string, unknown> = {}): Character {
	return {
		anchors: {bubble: {x: 0.5, y: 0.15}, mouth: {x: 0.5, y: 0.25}},
		poses: {angry: {asset: 'a_2'}, idle: {asset: 'a_1'}},
		id: 'mira',
		name: 'Mira',
		origin: {x: 0.5, y: 1},
		size: {h: 1024, w: 512},
		tags: [],
		...overrides
	} as unknown as Character;
}

describe('migrateCharacter', () => {
	it('copies a character-level rig onto every pose', () => {
		const migrated = migrateCharacter(legacy());

		expect(migrated.poses.idle.anchors).toEqual({
			bubble: {x: 0.5, y: 0.15},
			mouth: {x: 0.5, y: 0.25}
		});
		expect(migrated.poses.angry.anchors).toEqual(migrated.poses.idle.anchors);
	});

	// Two poses sharing one anchor object would make dragging one move the other, which is
	// exactly the bug this whole change exists to remove.
	it('gives each pose its own copy, not a shared reference', () => {
		const migrated = migrateCharacter(legacy());

		expect(migrated.poses.idle.anchors).not.toBe(migrated.poses.angry.anchors);
		expect(migrated.poses.idle.anchors!.bubble).not.toBe(
			migrated.poses.angry.anchors!.bubble
		);
	});

	it('drops the old top-level key', () => {
		const migrated = migrateCharacter(legacy()) as unknown as Record<
			string,
			unknown
		>;

		expect('anchors' in migrated).toBe(false);
	});

	it('leaves a pose that was already rigged alone', () => {
		const migrated = migrateCharacter(
			legacy({
				poses: {
					angry: {asset: 'a_2'},
					idle: {anchors: {bubble: {x: 0.9, y: 0.05}}, asset: 'a_1'}
				}
			})
		);

		expect(migrated.poses.idle.anchors).toEqual({bubble: {x: 0.9, y: 0.05}});
		expect(migrated.poses.angry.anchors).toEqual({
			bubble: {x: 0.5, y: 0.15},
			mouth: {x: 0.5, y: 0.25}
		});
	});

	it('is identity for a character already in today\'s shape', () => {
		const current = {
			poses: {idle: {anchors: {bubble: {x: 0.5, y: 0.1}}, asset: 'a_1'}},
			id: 'mira',
			name: 'Mira',
			origin: {x: 0.5, y: 1},
			size: {h: 1024, w: 512},
			tags: []
		} as Character;

		expect(migrateCharacter(current)).toBe(current);
	});

	// A bundle can hand over a character with neither shape. The editor opens on it, so it
	// needs something to list and something to drag.
	it('seeds a pose that has no rig and nothing to inherit', () => {
		const migrated = migrateCharacter({
			poses: {idle: {asset: 'a_1'}},
			id: 'mira',
			name: 'Mira',
			origin: {x: 0.5, y: 1},
			size: {h: 1024, w: 512},
			tags: []
		} as Character);

		expect(Object.keys(migrated.poses.idle.anchors ?? {})).toEqual([
			'bubble',
			'mouth'
		]);
	});

	it('has nothing to do for a character with no poses', () => {
		const empty = migrateCharacter(legacy({poses: {}})) as unknown as Record<
			string,
			unknown
		>;

		expect(empty.poses).toEqual({});
		expect('anchors' in empty).toBe(false);
	});
});

describe('newPoseAnchors', () => {
	it('copies the rig the character already uses', () => {
		const anchors = newPoseAnchors({
			poses: {
				idle: {anchors: {bubble: {x: 0.31, y: 0.09}}, asset: 'a_1'}
			}
		});

		expect(anchors).toEqual({bubble: {x: 0.31, y: 0.09}});
	});

	it('falls back to the defaults when there is nothing to copy', () => {
		expect(Object.keys(newPoseAnchors(undefined))).toEqual(['bubble', 'mouth']);
		expect(Object.keys(newPoseAnchors({poses: {}}))).toEqual([
			'bubble',
			'mouth'
		]);
	});

	it('hands back a copy, so editing the new pose cannot move the old one', () => {
		const character = {
			poses: {idle: {anchors: {bubble: {x: 0.31, y: 0.09}}, asset: 'a_1'}}
		};
		const anchors = newPoseAnchors(character);

		anchors.bubble.x = 0;

		expect(character.poses.idle.anchors.bubble.x).toBe(0.31);
	});
});

describe('anchorNames', () => {
	// Positions are per pose; the SET of names is not, or a scene asking for `mouth` would
	// work until the character changed pose.
	it('is the union across poses, in first-seen order', () => {
		expect(
			anchorNames({
				poses: {
					idle: {anchors: {bubble: {x: 0, y: 0}, mouth: {x: 0, y: 0}}, asset: 'a'},
					wave: {anchors: {hand: {x: 0, y: 0}, mouth: {x: 0, y: 0}}, asset: 'b'}
				}
			})
		).toEqual(['bubble', 'mouth', 'hand']);
	});

	it('is empty for a character with no poses', () => {
		expect(anchorNames({poses: {}})).toEqual([]);
	});
});
