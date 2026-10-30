/**
 * Copy / paste of stage entities: characters, props, particle emitters.
 *
 * A copy is the entity AS SEEN at the beat on screen -- position, pose, look -- frozen into
 * a whole new entry. Not the YAML of its entry: under `from:` an inherited character has no
 * entry, and a beat may have moved it. Pasting writes `add` writes (one edit, one undo step)
 * under fresh ids.
 *
 * Two carriers. The system clipboard (`text/plain` = the entries as YAML, for a paste into
 * the passage text; `SCENE_CLIP_MIME` = the clip itself, which Chrome carries across tabs),
 * and `lastClip` here, for a browser that drops the custom type and for the Paste button,
 * which has no clipboard event to read. `lastClip` only answers a paste whose text is still
 * the text it wrote -- once the author has copied anything else, it is stale.
 */

import {addEntities, applyEdit} from '@sliders/scene-edit';
import type {
	EntityId,
	EntityKind,
	EntityPatch,
	Scene,
	Stage,
	StageEntity
} from '@sliders/scene-types';
import {uniqueEntityId} from './scene-gestures';
import {roundCoord} from './stage-geometry';
import type {EntityStructWrite} from './use-scene-writer';

export const SCENE_CLIP_MIME = 'application/x-sliders-entities';

/** How far each paste into the scene it came from steps right, so it is not hidden. */
export const PASTE_STEP = 0.05;

export interface ClipEntity {
	id: EntityId;
	kind: EntityKind;
	patch: EntityPatch;
}

export interface SceneClip {
	v: 1;
	storyId?: string;
	passageId?: string;
	entities: ClipEntity[];
}

const KINDS: EntityKind[] = ['cast', 'prop', 'auto'];

function isUnit(value: number | undefined, unit: number) {
	return value === undefined || value === unit;
}

/** `{x, y}` -> `[x, y]`, the only spelling a step's `at` has in the text. */
function stepsPatch(entity: StageEntity) {
	return entity.steps?.map(step => {
		const {at, ...rest} = step;

		return at ? {...rest, at: [roundCoord(at.x), roundCoord(at.y)]} : rest;
	});
}

/**
 * One entity as a new entry. `authored` is the stage with `of` intact, `drawn` the resolved
 * one: a child keeps its offset only when its parent travels with it, otherwise it is pinned
 * where it stands. `locked` is left behind -- a pasted copy the author cannot drag off its
 * original is the one thing a paste must not produce.
 */
function entityPatch(
	authored: StageEntity,
	drawn: StageEntity,
	keepParent: boolean,
	condition: string | undefined
): EntityPatch {
	const relative = keepParent && authored.of !== undefined;
	const at = relative ? authored.at : drawn.at;
	const patch: Record<string, unknown> = {
		at: {x: roundCoord(at.x), y: roundCoord(at.y)},
		kind: authored.kind,
		ref: authored.ref
	};

	if (relative) {
		patch.of = authored.of;
	}

	if (!isUnit(authored.scale, 1)) patch.scale = authored.scale;
	if (
		authored.stretch &&
		(authored.stretch.x !== 1 || authored.stretch.y !== 1)
	) {
		patch.stretch = {...authored.stretch};
	}
	if (authored.rot) patch.rot = authored.rot;
	if (authored.steps?.length) {
		patch.pose = stepsPatch(authored);
		if (authored.poseLoop) patch.poseLoop = authored.poseLoop;
	} else if (authored.pose) {
		patch.pose = authored.pose;
	}
	if (authored.flip) patch.flip = true;
	if (authored.fit) patch.fit = authored.fit;
	if (authored.z !== undefined) patch.z = authored.z;
	if (!isUnit(authored.opacity, 1)) patch.opacity = authored.opacity;
	if (authored.grade && Object.keys(authored.grade).length) {
		patch.grade = {...authored.grade};
	}
	if (authored.emit && Object.keys(authored.emit).length) {
		patch.emit = {...authored.emit};
	}
	if (authored.motion) patch.motion = {...authored.motion};
	if (authored.link) patch.link = {...authored.link};
	if (authored.highlight) patch.highlight = authored.highlight;
	if (condition) patch.if = condition;

	return patch as unknown as EntityPatch;
}

/**
 * The selection as a clip. Undefined when nothing selected is on stage.
 *
 * Parents first, whatever order they were picked in, so a paste writes a child after the
 * entry its `of:` names.
 */
export function copyClip(
	authored: Stage,
	drawn: Stage,
	ids: EntityId[],
	scene?: Pick<Scene, 'entityIfs'>,
	source: {passageId?: string; storyId?: string} = {}
): SceneClip | undefined {
	const picked = ids.filter(
		id => authored?.entities?.[id] && drawn?.entities?.[id]
	);
	const set = new Set(picked);
	const depth = (id: EntityId) => {
		let n = 0;

		for (
			let parent = authored.entities[id]?.of;
			parent !== undefined && set.has(parent) && n < picked.length;
			parent = authored.entities[parent]?.of
		) {
			n++;
		}

		return n;
	};
	const ordered = [...picked].sort((a, b) => depth(a) - depth(b));

	if (ordered.length === 0) {
		return undefined;
	}

	return {
		entities: ordered.map(id => {
			const entity = authored.entities[id];

			return {
				id,
				kind: entity.kind,
				patch: entityPatch(
					entity,
					drawn.entities[id],
					entity.of !== undefined && set.has(entity.of),
					scene?.entityIfs?.[id]
				)
			};
		}),
		passageId: source.passageId,
		storyId: source.storyId,
		v: 1
	};
}

/**
 * What a paste writes, and the ids it mints. `taken` = every id the target stage already
 * uses (its entries AND what `from:` puts on screen). Ids keep their base (`mira` ->
 * `mira-2`); a cast copy keeps pointing at its character through `ref`. `of` follows the
 * parent's new id. `offset` moves the roots only -- children ride along.
 */
export function pasteWrites(
	clip: SceneClip,
	taken: EntityId[],
	offset = 0
): {ids: EntityId[]; writes: EntityStructWrite[]} {
	const used = [...taken];
	const renamed = new Map<EntityId, EntityId>();
	const ids: EntityId[] = [];
	const writes: EntityStructWrite[] = [];

	for (const entry of clip.entities) {
		const id = uniqueEntityId(entry.id, used);
		const patch = {...entry.patch} as EntityPatch & {of?: EntityId | null};
		const parent =
			typeof patch.of === 'string' ? renamed.get(patch.of) : undefined;

		used.push(id);
		renamed.set(entry.id, id);

		if (parent) {
			patch.of = parent;
		} else {
			delete patch.of;

			if (offset && patch.at) {
				patch.at = {x: roundCoord(patch.at.x + offset), y: patch.at.y};
			}
		}

		ids.push(id);
		writes.push({id, kind: entry.kind, patch, struct: 'add'});
	}

	return {ids, writes};
}

/** The clip as scene YAML (`cast:` / `props:` maps), for a paste into the passage text. */
export function clipText(clip: SceneClip): string {
	const edit = addEntities('', clip.entities);

	return edit ? applyEdit('', edit).trim() + '\n' : '';
}

/** A clip off the clipboard, which anyone may have written. Undefined unless it is one. */
export function readClip(json: string | undefined): SceneClip | undefined {
	if (!json) {
		return undefined;
	}

	try {
		const value = JSON.parse(json);

		if (
			value?.v !== 1 ||
			!Array.isArray(value.entities) ||
			value.entities.length === 0
		) {
			return undefined;
		}

		const ok = value.entities.every(
			(entry: ClipEntity) =>
				typeof entry?.id === 'string' &&
				entry.id !== '' &&
				KINDS.includes(entry.kind) &&
				typeof entry.patch === 'object' &&
				entry.patch !== null &&
				typeof entry.patch.ref === 'string' &&
				typeof entry.patch.at?.x === 'number' &&
				typeof entry.patch.at?.y === 'number'
		);

		return ok ? (value as SceneClip) : undefined;
	} catch {
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// The in-page clip
// ---------------------------------------------------------------------------

interface Held {
	clip: SceneClip;
	text: string;
	/** Pastes so far, per passage: each one into the same scene steps further right. */
	pastes: Record<string, number>;
}

let held: Held | undefined;
const listeners = new Set<() => void>();

export function holdClip(clip: SceneClip): string {
	const text = clipText(clip);

	held = {clip, pastes: {}, text};
	listeners.forEach(listener => listener());

	return text;
}

export function heldClip(): SceneClip | undefined {
	return held?.clip;
}

/** The held clip, if the clipboard's text is still the text it wrote. */
export function heldClipFor(text: string | undefined): SceneClip | undefined {
	return held && text === held.text ? held.clip : undefined;
}

/**
 * The offset for the next paste of `clip` into `passageId`. The scene it was copied from
 * starts one step off (the copy would cover its original); any other starts in place.
 */
export function nextPasteOffset(clip: SceneClip, passageId?: string): number {
	const key = passageId ?? '';
	const same = held?.clip === clip;
	const before = same ? held!.pastes[key] ?? 0 : 0;

	if (same) {
		held!.pastes[key] = before + 1;
	}

	const steps = before + (clip.passageId === passageId ? 1 : 0);

	return steps * PASTE_STEP;
}

export function subscribeClip(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Tests only. */
export function resetHeldClip() {
	held = undefined;
	listeners.forEach(listener => listener());
}
