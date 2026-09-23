/**
 * Character shape maintenance. Two old shapes:
 *
 * - `frames:` is now `poses:` (2026-09). Pure key rename, `upgradeCharacter`.
 * - anchors used to be per character, and are now per pose. One rig for a whole character
 *   only works while every pose faces the same way. The moment a character is drawn in
 *   profile, sitting, or turned away, the speech bubble is pinned to a spot that made sense
 *   in the idle pose and nowhere else — so `anchors` moved onto `CharacterPose`.
 *
 * Manifests written before either change carry the old shape, and there is no migration
 * step to run: `migrateCharacter` is applied on every read and every write, so a library
 * heals itself the first time it is opened and is written back clean the first time it is
 * saved.
 */

import {
	Character,
	CharacterPose,
	DEFAULT_POSE_ANCHORS,
	Frac2,
	upgradeCharacter
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
 * The rig a pose added right now should start with.
 *
 * Taken from a pose the character already has rather than from the constants: a sprite
 * sheet's poses are variations on one drawing, so the anchors that fit the others are far
 * closer to right than a generic bubble-above-the-shoulder, and the author adjusts from
 * there instead of placing every anchor from scratch.
 */
export function newPoseAnchors(
	character: Pick<Character, 'poses'> | undefined
): Record<string, Frac2> {
	for (const pose of Object.values(character?.poses ?? {})) {
		const existing = copyAnchors(pose.anchors);

		if (existing && Object.keys(existing).length > 0) {
			return existing;
		}
	}

	return copyAnchors(DEFAULT_POSE_ANCHORS)!;
}

/**
 * Every anchor name the character uses, in first-seen order.
 *
 * The editor keeps the SET of anchors the same across a character's poses — only their
 * positions differ — so that a scene asking for `mouth` finds one whichever pose is
 * showing. This is what that set is read from.
 */
export function anchorNames(character: Pick<Character, 'poses'>): string[] {
	const names: string[] = [];

	for (const pose of Object.values(character.poses ?? {})) {
		for (const name of Object.keys(pose.anchors ?? {})) {
			if (!names.includes(name)) {
				names.push(name);
			}
		}
	}

	return names;
}

/**
 * A character in today's shape: `poses:`, every pose rigged, nothing at the top level.
 *
 * A legacy rig is copied onto every pose that has none — which is all of them, since the
 * old shape had nowhere else to put one. A pose with no rig and no legacy to inherit gets
 * the same seed a freshly added pose would, so the editor never opens on a character whose
 * anchor list is empty and whose readout has nothing to show.
 *
 * Identity when there is nothing to do: the same object comes back, so a read path can
 * apply this to everything without churning references.
 */
export function migrateCharacter<T extends Character>(input: T): T {
	const character = upgradeCharacter(input);
	const stored = character as StoredCharacter;
	const legacy = copyAnchors(stored.anchors);
	const entries = Object.entries(character.poses ?? {});

	if (!legacy && entries.every(([, pose]) => pose.anchors)) {
		return character;
	}

	const seed = legacy ?? newPoseAnchors(character);
	const poses: Record<string, CharacterPose> = {};

	for (const [name, pose] of entries) {
		poses[name] = pose.anchors ? pose : {...pose, anchors: copyAnchors(seed)!};
	}

	const migrated = {...character, poses} as StoredCharacter;

	delete migrated.anchors;

	return migrated as T;
}
