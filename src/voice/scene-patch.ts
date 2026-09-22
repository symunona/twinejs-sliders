/**
 * Surgical scene edits from a YAML patch.
 *
 * The whole point is that the author's file comes back looking like the author's file. A
 * model handed `patch_scene` the obvious way — parse, mutate, re-serialise — returns a
 * block with every comment gone, every flow map exploded and the key order sorted. The
 * author sees a diff the size of the scene and stops trusting the microphone.
 *
 * So the patch is read for its SHAPE only, and each leaf becomes one `@sliders/scene-edit`
 * splice against the real text. Edits apply one at a time, re-parsing between, because
 * every splice invalidates the offsets the next one would have been computed from.
 */

import {extractSceneBlock} from '@sliders/scene-index';
import {
	applyEdit,
	formatValue,
	removeSceneKey,
	setBeatKey,
	setEntityKey,
	setSceneKey
} from '@sliders/scene-edit';
import type {EntityKind} from '@sliders/scene-types';
import {parse as parseYaml} from 'yaml';

/** Top-level keys a patch may set. `beats` is excluded on purpose — see `set_beat`. */
const SCENE_KEYS = new Set([
	'bg',
	'camera',
	'from',
	'fx',
	'id',
	'links',
	'music',
	'transition'
]);

const ENTITY_MAPS: Record<string, EntityKind> = {cast: 'cast', props: 'prop'};

export interface ScenePatchResult {
	/** What changed, as `bg`, `cast/mara at` — one per splice that landed. */
	changed: string[];
	error?: string;
	/** The passage text with every splice applied. Unchanged when `error` is set. */
	text: string;
}

/** `~` and an explicit null both mean "take this key out". */
function isRemoval(value: unknown): boolean {
	return value === null || value === undefined;
}

/**
 * Apply a YAML patch to the scene block inside `passageText`.
 *
 * Returns the whole passage, not the block: the caller dispatches a passage update, and
 * handing back a block would make every call site re-splice it.
 */
export function patchSceneText(
	passageText: string,
	patchYaml: string
): ScenePatchResult {
	const block = extractSceneBlock(passageText);

	if (!block) {
		return {changed: [], error: 'that passage has no [scene] block', text: passageText};
	}

	let patch: unknown;

	try {
		patch = parseYaml(patchYaml);
	} catch (error) {
		return {
			changed: [],
			error: `patch is not YAML: ${(error as Error).message}`,
			text: passageText
		};
	}

	if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
		return {changed: [], error: 'patch must be a YAML map of keys', text: passageText};
	}

	if ('beats' in (patch as Record<string, unknown>)) {
		return {
			changed: [],
			// Rewriting the beat list wholesale is exactly the reserialisation this module
			// exists to avoid, and `set_beat` already does the surgical version.
			error: 'beats are not patchable here — use set_beat, one beat at a time',
			text: passageText
		};
	}

	let text = block.text;
	const changed: string[] = [];

	for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
		const entityKind = ENTITY_MAPS[key];

		if (entityKind) {
			if (value === null || typeof value !== 'object' || Array.isArray(value)) {
				return {
					changed,
					error: `${key}: wants a map of entity id to its keys`,
					text: passageText
				};
			}

			for (const [id, body] of Object.entries(value as Record<string, unknown>)) {
				if (body === null || typeof body !== 'object' || Array.isArray(body)) {
					return {
						changed,
						error: `${key}/${id}: wants a map of keys, e.g. {at: [0.4, 0.9]}`,
						text: passageText
					};
				}

				for (const [entityKey, entityValue] of Object.entries(
					body as Record<string, unknown>
				)) {
					const edit = setEntityKey(
						text,
						{id, kind: entityKind},
						entityKey,
						isRemoval(entityValue) ? null : entityValue
					);

					if (!edit) {
						return {
							changed,
							error: `${key}/${id}: no such entity in this scene`,
							text: passageText
						};
					}

					text = applyEdit(text, edit);
					changed.push(`${key}/${id} ${entityKey}`);
				}
			}

			continue;
		}

		if (!SCENE_KEYS.has(key)) {
			return {
				changed,
				error: `unknown scene key '${key}'`,
				text: passageText
			};
		}

		const edit = isRemoval(value)
			? removeSceneKey(text, key)
			: setSceneKey(text, key, formatValue(key, value));

		if (!edit) {
			// `removeSceneKey` returns nothing when the key was not there. Asking for a
			// key to be gone that is already gone is not a failure.
			changed.push(`${key} (already absent)`);
			continue;
		}

		text = applyEdit(text, edit);
		changed.push(key);
	}

	return {
		changed,
		text: spliceBlock(passageText, block.offset, block.text.length, text)
	};
}

/** Put an edited block back into its passage. */
function spliceBlock(
	passageText: string,
	offset: number,
	oldLength: number,
	next: string
): string {
	return (
		passageText.slice(0, offset) + next + passageText.slice(offset + oldLength)
	);
}

export interface BeatPatchResult {
	changed: string[];
	error?: string;
	text: string;
}

/** `set_beat`: one beat, one key at a time, same rules. */
export function patchBeatText(
	passageText: string,
	beat: number,
	patchYaml: string
): BeatPatchResult {
	const block = extractSceneBlock(passageText);

	if (!block) {
		return {changed: [], error: 'that passage has no [scene] block', text: passageText};
	}

	let patch: unknown;

	try {
		patch = parseYaml(patchYaml);
	} catch (error) {
		return {
			changed: [],
			error: `patch is not YAML: ${(error as Error).message}`,
			text: passageText
		};
	}

	if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
		return {changed: [], error: 'patch must be a YAML map of beat keys', text: passageText};
	}

	let text = block.text;
	const changed: string[] = [];

	for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
		const edit = setBeatKey(text, beat, key, isRemoval(value) ? null : value);

		if (!edit) {
			if (isRemoval(value)) {
				changed.push(`${key} (already absent)`);
				continue;
			}

			return {changed, error: `no beat ${beat} in this scene`, text: passageText};
		}

		text = applyEdit(text, edit);
		changed.push(key);
	}

	return {
		changed,
		text: spliceBlock(passageText, block.offset, block.text.length, text)
	};
}
