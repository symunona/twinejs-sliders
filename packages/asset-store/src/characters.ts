/**
 * Character shape maintenance: anchors used to be per character, and are now per frame.
 *
 * One rig for a whole character only works while every frame faces the same way. The moment
 * a character is drawn in profile, sitting, or turned away, the speech bubble is pinned to
 * a spot that made sense in the idle pose and nowhere else — so `anchors` moved onto
 * `CharacterFrame`, where the pose that decides them lives.
 *
 * Manifests written before that change carry the old shape, and there is no migration step
 * to run: `migrateCharacter` is applied on every read and every write, so a library heals
 * itself the first time it is opened and is written back clean the first time it is saved.
 */

import {
	Character,
	CharacterFrame,
	DEFAULT_FRAME_ANCHORS,
	Frac2
} from '@sliders/scene-types';

/** A character as it may still exist on disk, with the rig at the top level. */
type StoredCharacter = Character & {anchors?: Record<string, Frac2>};

function copyAnchors(
	anchors: Record<string, Frac2> | undefined
): Record<string, Frac2> | undefined {
	if (!anchors) {
		return undefined;
	}

	const copy: Record<string, Frac2> = {};

	for (const [name, value] of Object.entries(anchors)) {
		if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) {
			copy[name] = {x: value.x, y: value.y};
		}
	}

	return copy;
}

/**
 * The rig a frame added right now should start with.
 *
 * Taken from a frame the character already has rather than from the constants: a sprite
 * sheet's poses are variations on one drawing, so the anchors that fit the others are far
 * closer to right than a generic bubble-above-the-shoulder, and the author adjusts from
 * there instead of placing every anchor from scratch.
 */
export function newFrameAnchors(
	character: Pick<Character, 'frames'> | undefined
): Record<string, Frac2> {
	for (const frame of Object.values(character?.frames ?? {})) {
		const existing = copyAnchors(frame.anchors);

		if (existing && Object.keys(existing).length > 0) {
			return existing;
		}
	}

	return copyAnchors(DEFAULT_FRAME_ANCHORS)!;
}

/**
 * Every anchor name the character uses, in first-seen order.
 *
 * The editor keeps the SET of anchors the same across a character's frames — only their
 * positions differ — so that a scene asking for `mouth` finds one whichever frame is
 * showing. This is what that set is read from.
 */
export function anchorNames(character: Pick<Character, 'frames'>): string[] {
	const names: string[] = [];

	for (const frame of Object.values(character.frames ?? {})) {
		for (const name of Object.keys(frame.anchors ?? {})) {
			if (!names.includes(name)) {
				names.push(name);
			}
		}
	}

	return names;
}

/**
 * A character in today's shape: every frame rigged, nothing at the top level.
 *
 * A legacy rig is copied onto every frame that has none — which is all of them, since the
 * old shape had nowhere else to put one. A frame with no rig and no legacy to inherit gets
 * the same seed a freshly added frame would, so the editor never opens on a character whose
 * anchor list is empty and whose readout has nothing to show.
 *
 * Identity when there is nothing to do: the same object comes back, so a read path can
 * apply this to everything without churning references.
 */
export function migrateCharacter<T extends Character>(character: T): T {
	const stored = character as StoredCharacter;
	const legacy = copyAnchors(stored.anchors);
	const entries = Object.entries(character.frames ?? {});

	if (!legacy && entries.every(([, frame]) => frame.anchors)) {
		return character;
	}

	const seed = legacy ?? newFrameAnchors(character);
	const frames: Record<string, CharacterFrame> = {};

	for (const [name, frame] of entries) {
		frames[name] = frame.anchors ? frame : {...frame, anchors: copyAnchors(seed)!};
	}

	const migrated = {...character, frames} as StoredCharacter;

	delete migrated.anchors;

	return migrated as T;
}
