import {Character} from '@sliders/scene-types';
import {anchorNames, migrateCharacter, newFrameAnchors} from '../characters';

/** A character in the shape libraries written before anchors moved onto frames. */
function legacy(overrides: Record<string, unknown> = {}): Character {
	return {
		anchors: {bubble: {x: 0.5, y: 0.15}, mouth: {x: 0.5, y: 0.25}},
		frames: {angry: {asset: 'a_2'}, idle: {asset: 'a_1'}},
		id: 'mira',
		name: 'Mira',
		origin: {x: 0.5, y: 1},
		size: {h: 1024, w: 512},
		tags: [],
		...overrides
	} as unknown as Character;
}

describe('migrateCharacter', () => {
	it('copies a character-level rig onto every frame', () => {
		const migrated = migrateCharacter(legacy());

		expect(migrated.frames.idle.anchors).toEqual({
			bubble: {x: 0.5, y: 0.15},
			mouth: {x: 0.5, y: 0.25}
		});
		expect(migrated.frames.angry.anchors).toEqual(migrated.frames.idle.anchors);
	});

	// Two frames sharing one anchor object would make dragging one move the other, which is
	// exactly the bug this whole change exists to remove.
	it('gives each frame its own copy, not a shared reference', () => {
		const migrated = migrateCharacter(legacy());

		expect(migrated.frames.idle.anchors).not.toBe(migrated.frames.angry.anchors);
		expect(migrated.frames.idle.anchors!.bubble).not.toBe(
			migrated.frames.angry.anchors!.bubble
		);
	});

	it('drops the old top-level key', () => {
		const migrated = migrateCharacter(legacy()) as unknown as Record<
			string,
			unknown
		>;

		expect('anchors' in migrated).toBe(false);
	});

	it('leaves a frame that was already rigged alone', () => {
		const migrated = migrateCharacter(
			legacy({
				frames: {
					angry: {asset: 'a_2'},
					idle: {anchors: {bubble: {x: 0.9, y: 0.05}}, asset: 'a_1'}
				}
			})
		);

		expect(migrated.frames.idle.anchors).toEqual({bubble: {x: 0.9, y: 0.05}});
		expect(migrated.frames.angry.anchors).toEqual({
			bubble: {x: 0.5, y: 0.15},
			mouth: {x: 0.5, y: 0.25}
		});
	});

	it('is identity for a character already in today\'s shape', () => {
		const current = {
			frames: {idle: {anchors: {bubble: {x: 0.5, y: 0.1}}, asset: 'a_1'}},
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
	it('seeds a frame that has no rig and nothing to inherit', () => {
		const migrated = migrateCharacter({
			frames: {idle: {asset: 'a_1'}},
			id: 'mira',
			name: 'Mira',
			origin: {x: 0.5, y: 1},
			size: {h: 1024, w: 512},
			tags: []
		} as Character);

		expect(Object.keys(migrated.frames.idle.anchors ?? {})).toEqual([
			'bubble',
			'mouth'
		]);
	});

	it('has nothing to do for a character with no frames', () => {
		const empty = migrateCharacter(legacy({frames: {}})) as unknown as Record<
			string,
			unknown
		>;

		expect(empty.frames).toEqual({});
		expect('anchors' in empty).toBe(false);
	});
});

describe('newFrameAnchors', () => {
	it('copies the rig the character already uses', () => {
		const anchors = newFrameAnchors({
			frames: {
				idle: {anchors: {bubble: {x: 0.31, y: 0.09}}, asset: 'a_1'}
			}
		});

		expect(anchors).toEqual({bubble: {x: 0.31, y: 0.09}});
	});

	it('falls back to the defaults when there is nothing to copy', () => {
		expect(Object.keys(newFrameAnchors(undefined))).toEqual(['bubble', 'mouth']);
		expect(Object.keys(newFrameAnchors({frames: {}}))).toEqual([
			'bubble',
			'mouth'
		]);
	});

	it('hands back a copy, so editing the new frame cannot move the old one', () => {
		const character = {
			frames: {idle: {anchors: {bubble: {x: 0.31, y: 0.09}}, asset: 'a_1'}}
		};
		const anchors = newFrameAnchors(character);

		anchors.bubble.x = 0;

		expect(character.frames.idle.anchors.bubble.x).toBe(0.31);
	});
});

describe('anchorNames', () => {
	// Positions are per frame; the SET of names is not, or a scene asking for `mouth` would
	// work until the character changed pose.
	it('is the union across frames, in first-seen order', () => {
		expect(
			anchorNames({
				frames: {
					idle: {anchors: {bubble: {x: 0, y: 0}, mouth: {x: 0, y: 0}}, asset: 'a'},
					wave: {anchors: {hand: {x: 0, y: 0}, mouth: {x: 0, y: 0}}, asset: 'b'}
				}
			})
		).toEqual(['bubble', 'mouth', 'hand']);
	});

	it('is empty for a character with no frames', () => {
		expect(anchorNames({frames: {}})).toEqual([]);
	});
});
