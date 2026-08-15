/**
 * Gesture -> ONE text edit -> CodeMirror (spec 09, phases 2 and 3).
 *
 * Everything above the CodeMirror call is a pure function of its arguments, because the
 * interesting part — *which* `at:` a drag writes when the scrubber sits on beat 3 — is a
 * rule, not a rendering concern, and a rule that can only be checked by dragging a sprite
 * in a browser is a rule nobody checks.
 *
 * The text is the source of truth: nothing here keeps a scene model. A gesture reads the
 * value it is moving out of the stage the author is looking at, produces a splice, and the
 * preview re-parses whatever comes back.
 */

import * as React from 'react';
import {
	addEntity,
	applyEdit,
	mergeEdits,
	removeEntities,
	removeEntityKey,
	removeSceneKey,
	setEntityKey,
	setSceneKey
} from '@sliders/scene-edit';
import type {EntityTarget, TextEdit} from '@sliders/scene-edit';
import type {
	Beat,
	Camera,
	EntityId,
	EntityKind,
	EntityPatch,
	Scene,
	Stage,
	Vec2
} from '@sliders/scene-types';

/**
 * Re-exported so this module stays the one place a gesture reaches for when it needs to fold
 * its splices — `mergeEdits` lives in the package because `removeEntities` needs it too.
 */
export {mergeEdits};

/**
 * Origins. Deliberately NOT prefixed with `+` or `*`.
 *
 * CodeMirror 5 merges a change into the previous history event when the origin matches the
 * last one AND either it starts with `+` and lands inside `historyEventDelay`, or it starts
 * with `*` — and `*` has no time limit at all (`addChangeToHistory`, codemirror.js). So a
 * `*` origin would fuse two drags made ten minutes apart into a single undo step, which is
 * the opposite of what we want: one drag, one undo.
 *
 * A nudge burst is the case where merging IS wanted — tapping left five times is one
 * intent, not five — so that one keeps the `+`, and stops merging once the author pauses.
 */
export const DRAG_ORIGIN = 'sliders-drag';
export const NUDGE_ORIGIN = '+sliders-nudge';

/**
 * One deliberate keypress or click — flip, layer, frame, delete. One undo entry each: two
 * flips in a row are two decisions, and merging them would make the first one unreachable.
 */
export const EDIT_ORIGIN = 'sliders-edit';

/** A dropped asset. Structural, and never merged with whatever came before it. */
export const DROP_ORIGIN = 'sliders-drop';

/** Repeatable bursts, merged the way a nudge burst is: tapping `]` four times is one intent. */
export const Z_ORIGIN = '+sliders-z';
export const CAMERA_ORIGIN = '+sliders-camera';

/** Did this document change come from us? Anything else seals an in-flight drag. */
export function isOwnOrigin(origin: string | undefined): boolean {
	// The prefix is stripped first because react-codemirror2 replays our change onto the
	// real document after its round trip through React, origin and all.
	return !!origin && origin.replace(/^[+*]/, '').startsWith('sliders-');
}

// ---------------------------------------------------------------------------
// Where a write lands
// ---------------------------------------------------------------------------

export interface WritePlan {
	/**
	 * Targets to try, best first. `setEntityKey` returns undefined for an entry that is not
	 * there, which is the signal to move on to the next one.
	 */
	targets: EntityTarget[];
	/**
	 * Nothing to write into: the entity is on stage because a `from:` scene put it there,
	 * and moving it means giving this scene a local entry of its own.
	 */
	addEntity: boolean;
}

/** Does this beat already move, resize or otherwise patch that entity? */
export function beatPatchesEntity(
	beat: Beat | undefined,
	id: EntityId
): boolean {
	if (!beat) {
		return false;
	}

	if (beat.kind === 'set') {
		return beat.who === id;
	}

	// A bare `- mira: "Get out."` says something but stages nothing. Writing `at:` there
	// would promote it to `{say: …, at: …}` and pin the move to that one line of dialogue,
	// when what the author dragged was the character, not the line.
	return (
		beat.kind === 'say' &&
		beat.who === id &&
		!!beat.patch &&
		Object.keys(beat.patch).length > 0
	);
}

/**
 * Where a drag or resize on `id` should write, given where the scrubber is.
 *
 * The rule (spec 09) is "write what the eye is looking at": if the beat on screen already
 * patches this entity, that patch is what put it where it is, so that is what moves.
 * Otherwise the `cast:` / `props:` entry is.
 *
 * `beat` is the SCRUBBER index — state N is produced by `beats[N - 1]`, so state 0 is the
 * stage before any beat ran and can only ever write the entry.
 */
export function planEntityWrite(
	scene: Scene | undefined,
	beat: number,
	kind: EntityKind,
	id: EntityId
): WritePlan {
	const targets: EntityTarget[] = [];
	const index = beat - 1;

	if (index >= 0 && beatPatchesEntity(scene?.beats?.[index], id)) {
		// `EntityTarget.beat` indexes the YAML `beats:` sequence, `scene.beats` skips items
		// the parser rejected. They agree unless the block has a malformed beat, and
		// `locateEntity` checks the speaker id before writing, so a disagreement falls
		// through to the entry below instead of writing into the wrong beat.
		targets.push({beat: index, id, kind});
	}

	targets.push({id, kind});

	return {addEntity: !scene?.entities?.[id], targets};
}

// ---------------------------------------------------------------------------
// Building edits
// ---------------------------------------------------------------------------

export interface EntityKeyWrite {
	id: EntityId;
	kind: EntityKind;
	/** Character id or asset id. Only needed if a whole entry has to be created. */
	ref: string;
	key: string;
	/** `undefined` REMOVES the key — how `scale: 1` and `flip: false` go away. */
	value: unknown;
}

/**
 * A whole entry appearing or disappearing: a drop from the asset panel, or Delete.
 *
 * Separate from `EntityKeyWrite` because these are the only two writes that are not a key
 * on an existing entry, and because removal has a rule of its own — a scene with `from:`
 * must write `id: ~` rather than deleting the line (spec 02, and `removeEntity`'s
 * `isPatchScene`). That flag is derived from the scene here rather than passed in, so a
 * caller cannot get it wrong.
 */
export interface EntityStructWrite {
	id: EntityId;
	kind: EntityKind;
	struct: 'add' | 'remove';
	/** For `add`: the whole entry to write. */
	patch?: EntityPatch;
}

/**
 * A top-level scene key — `bg:` from a background drop, `camera:` from a pan or zoom.
 *
 * The value arrives already formatted because the two keys serialize differently and the
 * rules that decide their shape (a camera at identity is REMOVED, not written out) belong
 * with the gestures, not with the splicer.
 */
export interface SceneKeyWrite {
	sceneKey: 'bg' | 'camera';
	/** Formatted YAML. `undefined` REMOVES the key. */
	formatted?: string;
}

export type SceneWrite = EntityKeyWrite | EntityStructWrite | SceneKeyWrite;

export function isSceneKeyWrite(write: SceneWrite): write is SceneKeyWrite {
	return 'sceneKey' in write;
}

export function isStructWrite(write: SceneWrite): write is EntityStructWrite {
	return 'struct' in write;
}

export interface SceneWriteContext {
	/** The `[scene]` block text. All `TextEdit` offsets are relative to this. */
	blockText: string;
	/** Character index of the block inside the passage. */
	blockOffset: number;
	scene?: Scene;
	/** Scrubber position. */
	beat: number;
}

/** One write's edit, or undefined when there is nowhere sane to put it. */
export function buildEntityEdit(
	context: SceneWriteContext,
	write: EntityKeyWrite
): TextEdit | undefined {
	const {blockText, beat, scene} = context;
	const plan = planEntityWrite(scene, beat, write.kind, write.id);

	for (const target of plan.targets) {
		const edit =
			write.value === undefined
				? removeEntityKey(blockText, target, write.key)
				: setEntityKey(blockText, target, write.key, write.value);

		if (edit) {
			return edit;
		}
	}

	// Removing a key that is not written anywhere is a no-op, not a reason to create an
	// entry saying so.
	if (!plan.addEntity || write.value === undefined) {
		return undefined;
	}

	return addEntity(blockText, write.kind, write.id, {
		kind: write.kind,
		ref: write.ref,
		[write.key]: write.value
	} as EntityPatch);
}

/**
 * Delete every id of one kind at once.
 *
 * With `from:`, an absent key means INHERITED, so deleting the line would put the entity
 * straight back on stage — `removeEntities` writes `id: ~` instead. The ids go in together
 * because whether the `cast:` map survives depends on how many of them there are: asked once
 * per id against the same original text, every answer is "the map still has others" and the
 * merge leaves an empty `cast:` behind.
 */
function buildRemoveEdit(
	context: SceneWriteContext,
	kind: EntityKind,
	ids: EntityId[]
): TextEdit | undefined {
	return removeEntities(context.blockText, kind, ids, !!context.scene?.from);
}

/** One write of any kind, or undefined when there is nowhere sane to put it. */
export function buildWriteEdit(
	context: SceneWriteContext,
	write: SceneWrite
): TextEdit | undefined {
	if (isSceneKeyWrite(write)) {
		return write.formatted === undefined
			? removeSceneKey(context.blockText, write.sceneKey)
			: setSceneKey(context.blockText, write.sceneKey, write.formatted);
	}

	if (isStructWrite(write)) {
		if (write.struct === 'add') {
			return write.patch
				? addEntity(context.blockText, write.kind, write.id, write.patch)
				: undefined;
		}

		return buildRemoveEdit(context, write.kind, [write.id]);
	}

	return buildEntityEdit(context, write);
}

/**
 * Every write of a gesture, as edits against the ORIGINAL block text.
 *
 * Removals are pooled per kind rather than built one at a time, because that decision — does
 * the map go with them? — can only be made with the whole selection in hand. Everything else
 * is independent and goes through `buildWriteEdit` unchanged.
 */
export function buildWriteEdits(
	context: SceneWriteContext,
	writes: SceneWrite[]
): TextEdit[] {
	const edits: TextEdit[] = [];
	const removed = new Map<EntityKind, EntityId[]>();

	for (const write of writes) {
		if (isStructWrite(write) && write.struct === 'remove') {
			removed.set(write.kind, [...(removed.get(write.kind) ?? []), write.id]);
			continue;
		}

		const edit = buildWriteEdit(context, write);

		if (edit) {
			edits.push(edit);
		}
	}

	for (const [kind, ids] of removed) {
		const edit = buildRemoveEdit(context, kind, ids);

		if (edit) {
			edits.push(edit);
		}
	}

	return edits;
}

/**
 * One gesture must be one `replaceRange`, and not only for undo: the passage editor's
 * CodeMirror is CONTROLLED, and react-codemirror2 keeps exactly one deferred change at a
 * time — a second `replaceRange` in the same tick overwrites the first and the document is
 * only rescued by a whole-document `setValue`. `mergeEdits` re-inserts the text between two
 * edits unchanged, so a multi-select drag still restores in a single undo.
 */

/** What the block text becomes. Used to know when the parse has caught up. */
export function previewEdits(text: string, edits: TextEdit[]): string {
	const merged = mergeEdits(text, edits);

	return merged ? applyEdit(text, merged) : text;
}

// ---------------------------------------------------------------------------
// Putting it through CodeMirror
// ---------------------------------------------------------------------------

/** The slice of `CodeMirror.Editor` a write needs. Keeps the tests free of a real editor. */
export interface WritableEditor {
	posFromIndex(index: number): CodeMirror.Position;
	replaceRange(
		replacement: string,
		from: CodeMirror.Position,
		to: CodeMirror.Position,
		origin?: string
	): void;
}

/**
 * Apply a gesture's writes. Returns true when the document actually changed.
 *
 * All writes go through the CodeMirror document and never around it, so Twine's undo works
 * for free and a drag shares one history stack with typing (spec 07).
 */
export function writeSceneEdits(
	editor: WritableEditor | undefined,
	context: SceneWriteContext,
	writes: SceneWrite[],
	origin: string = DRAG_ORIGIN
): boolean {
	if (!editor || writes.length === 0) {
		return false;
	}

	const merged = mergeEdits(
		context.blockText,
		buildWriteEdits(context, writes)
	);

	if (!merged || applyEdit(context.blockText, merged) === context.blockText) {
		return false;
	}

	editor.replaceRange(
		merged.insert,
		editor.posFromIndex(merged.from + context.blockOffset),
		editor.posFromIndex(merged.to + context.blockOffset),
		origin
	);

	return true;
}

// ---------------------------------------------------------------------------
// The optimistic patch
// ---------------------------------------------------------------------------

/** Values held locally while a gesture runs and until the parse catches up. */
export interface StagePatch {
	[id: string]: {at?: {x: number; y: number}; scale?: number};
}

/**
 * The stage the author sees: the parsed one with the gesture's values painted over it.
 *
 * This is the whole of "nothing is written during the drag" — the renderer reconciles
 * against this at 60 fps with no reparse, and the document sees one edit on pointerup.
 */
export function applyStagePatch(stage: Stage, patch: StagePatch): Stage {
	const ids = Object.keys(patch ?? {});

	if (ids.length === 0) {
		return stage;
	}

	const entities = {...stage.entities};
	let changed = false;

	for (const id of ids) {
		const entity = entities[id];

		if (!entity) {
			continue;
		}

		entities[id] = {
			...entity,
			...(patch[id].at ? {at: patch[id].at as Vec2} : {}),
			...(patch[id].scale === undefined
				? {}
				: {scale: patch[id].scale as number})
		};
		changed = true;
	}

	return changed ? {...stage, entities} : stage;
}

/**
 * The camera the author sees while a pan or a zoom burst is live.
 *
 * Kept apart from `StagePatch` rather than folded into it: that map is keyed by entity id,
 * and a scene is perfectly entitled to contain an entity called `camera`.
 */
export function applyCameraPatch(
	stage: Stage,
	camera: Camera | undefined
): Stage {
	return camera ? {...stage, camera} : stage;
}

/** Positions match to well within a rounded coordinate's last digit. */
const AGREE_EPSILON = 1e-4;

/** Has the parse caught up with a camera the gesture already painted? */
export function cameraAgrees(patched: Camera, actual: Camera | undefined): boolean {
	return (
		!!actual &&
		Math.abs(patched.at.x - actual.at.x) <= AGREE_EPSILON &&
		Math.abs(patched.at.y - actual.at.y) <= AGREE_EPSILON &&
		Math.abs(patched.zoom - actual.zoom) <= AGREE_EPSILON
	);
}

/**
 * How long an optimistic patch may outlive the write that should replace it.
 *
 * The parse is debounced, so for a moment after the write the parsed stage still holds the
 * OLD position while the drag patch is gone — the sprite snaps back and then forward again,
 * which reads as a broken editor. The patch therefore survives until the parse agrees, or
 * until this elapses, whichever comes first. A stuck patch would be worse than a flash:
 * this is the escape hatch for a write that lands somewhere the scrubber cannot see.
 */
export const PATCH_TIMEOUT_MS = 900;

function agrees(
	patched: StagePatch[string],
	actual: {at: {x: number; y: number}; scale: number} | undefined
): boolean {
	if (!actual) {
		return false;
	}

	if (
		patched.at &&
		(Math.abs(patched.at.x - actual.at.x) > AGREE_EPSILON ||
			Math.abs(patched.at.y - actual.at.y) > AGREE_EPSILON)
	) {
		return false;
	}

	return !(
		patched.scale !== undefined &&
		Math.abs(patched.scale - actual.scale) > AGREE_EPSILON
	);
}

/** Drop the patch entries the freshly parsed stage now agrees with. */
export function settlePatch(
	patch: StagePatch,
	entities: Record<string, {at: {x: number; y: number}; scale: number}>
): StagePatch {
	const next: StagePatch = {};
	let changed = false;

	for (const [id, values] of Object.entries(patch)) {
		if (agrees(values, entities[id])) {
			changed = true;
		} else {
			next[id] = values;
		}
	}

	return changed ? next : patch;
}

export interface ScenePatchState {
	patch: StagePatch;
	/** Replace the whole patch. Called on every pointermove of a drag. */
	setPatch(patch: StagePatch): void;
	/** Merge into it — a nudge only ever touches the keys it moved. */
	mergePatch(patch: StagePatch): void;
	clearPatch(): void;
	/** Start the timeout that guarantees the patch cannot outlive its write. */
	holdPatch(): void;
}

/**
 * The patch the drag paints with, and the timer that guarantees it goes away.
 *
 * Nothing is written to the text during a drag: the renderer moves at 60 fps off this,
 * with no reparse, and the document sees exactly one edit on pointerup.
 */
export function useScenePatch(): ScenePatchState {
	const [patch, setPatchState] = React.useState<StagePatch>({});
	const timer = React.useRef<number>();
	// Mirrors the state. A pointerup runs in the same event as the last pointermove, so
	// `holdPatch` would otherwise snapshot the patch from before that move.
	const current = React.useRef<StagePatch>(patch);

	const write = React.useCallback((next: StagePatch) => {
		current.current = next;
		setPatchState(next);
	}, []);

	const cancelTimer = React.useCallback(() => {
		if (timer.current !== undefined) {
			window.clearTimeout(timer.current);
			timer.current = undefined;
		}
	}, []);

	React.useEffect(() => cancelTimer, [cancelTimer]);

	return React.useMemo(
		() => ({
			patch,
			clearPatch() {
				cancelTimer();
				write({});
			},
			holdPatch() {
				cancelTimer();

				// Only the entries this write is responsible for time out. A gesture
				// started while the timer was running holds NEW value objects, and
				// dropping those would yank the sprite out from under the pointer.
				const held = current.current;

				timer.current = window.setTimeout(() => {
					timer.current = undefined;

					const next: StagePatch = {};
					let changed = false;

					for (const [id, value] of Object.entries(current.current)) {
						if (held[id] === value) {
							changed = true;
						} else {
							next[id] = value;
						}
					}

					if (changed) {
						write(next);
					}
				}, PATCH_TIMEOUT_MS);
			},
			mergePatch(next) {
				write({...current.current, ...next});
			},
			setPatch(next) {
				write(next);
			}
		}),
		[cancelTimer, patch, write]
	);
}
