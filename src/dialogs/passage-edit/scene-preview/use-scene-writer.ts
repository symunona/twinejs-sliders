/**
 * Gesture -> ONE text edit -> CodeMirror (spec 10, phases 2 and 3).
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
	entityHasParent,
	insertBeatEntity,
	mergeEdits,
	removeEntities,
	removeEntityKey,
	removeSceneKey,
	setBeatBubble,
	setBeatKey,
	setEntityKey,
	setSceneKey
} from '@sliders/scene-edit';
import type {
	BubbleGeometry,
	EntityTarget,
	TextEdit
} from '@sliders/scene-edit';
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
 * One deliberate keypress or click — flip, layer, pose, delete. One undo entry each: two
 * flips in a row are two decisions, and merging them would make the first one unreachable.
 */
export const EDIT_ORIGIN = 'sliders-edit';

/** A dropped asset. Structural, and never merged with whatever came before it. */
export const DROP_ORIGIN = 'sliders-drop';

/** Repeatable bursts, merged the way a nudge burst is: tapping `]` four times is one intent. */
export const Z_ORIGIN = '+sliders-z';
export const CAMERA_ORIGIN = '+sliders-camera';

/**
 * A Fix button on a scene error. One click, one undo entry — each fix is a separate guess
 * the author accepted, and merging two of them would make the first unreviewable.
 */
export const FIX_ORIGIN = 'sliders-fix';

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
	 *
	 * Empty means the gesture has nowhere to go and must be rolled back — see `blocked`.
	 */
	targets: EntityTarget[];
	/**
	 * Nothing to write into: the entity is on stage because a `from:` scene put it there,
	 * and moving it means giving this scene a local entry of its own.
	 */
	addEntity: boolean;
	/**
	 * There is no line of this entity's to write on, so the gesture gets one: a new set beat
	 * spliced in at this seq position.
	 *
	 * The scrubber is parked on a beat belonging to somebody else, and a beat item has
	 * exactly one key, so this entity cannot join it. The `cast:` entry is NOT a fallback
	 * here — it would move the character from the TOP of the scene, restaging every beat
	 * before this one from a position the author never saw. The moment on screen is the one
	 * after the beat shown, so a beat of its own, immediately after it, is the only place
	 * that means what the gesture meant.
	 */
	insertBeat?: {
		/** Seq position the new item lands at. */
		index: number;
		/** The beat it follows, 0-based — what the author is told about. */
		after: number;
		/** Who owns that beat, when anybody does. */
		owner?: EntityId;
	};
}

/**
 * Is this beat the entity's OWN line — the one place a stage key for it can go?
 *
 * True for any `say` or `set` beat whose speaker is this id, whatever the beat currently
 * carries. A bare `- mira: "Get out."` counts: writing `at:` there promotes it to
 * `{say: …, at: …}`, and that is right, because that beat is what put her where the author
 * is looking at her.
 *
 * This used to demand an existing patch, so a bare dialogue beat sent the write to `cast:`
 * instead — which moved the character from the TOP of the scene, restaging every beat
 * before this one from a position the author never saw. Pinning the move to the line is
 * the lesser of the two.
 */
export function beatOwnsEntity(beat: Beat | undefined, id: EntityId): boolean {
	return !!beat && (beat.kind === 'say' || beat.kind === 'set') && beat.who === id;
}

/**
 * Where a drag or resize on `id` should write, given where the scrubber is.
 *
 * The rule is "write what the eye is looking at":
 *
 * - Scrubber at 0 — the stage before any beat ran — writes the `cast:` / `props:` entry.
 * - Scrubber on a beat that belongs to this entity writes THAT BEAT, promoting a bare line
 *   of dialogue to a map if that is what it takes.
 * - Scrubber on somebody else's beat gets a new set beat of its own, right after it. A beat
 *   item has exactly one key, so this entity cannot join theirs, and falling through to the
 *   entry would move them from the top of the scene instead of from here.
 *
 * `beat` is the SCRUBBER index — state N is produced by `beats[N - 1]`.
 */
export function planEntityWrite(
	scene: Scene | undefined,
	beat: number,
	kind: EntityKind,
	id: EntityId
): WritePlan {
	const index = beat - 1;
	const onBeat = index >= 0 && index < (scene?.beats?.length ?? 0);
	const addEntity = !scene?.entities?.[id];

	if (!onBeat) {
		return {addEntity, targets: [{id, kind}]};
	}

	const shown = scene?.beats?.[index];

	if (!beatOwnsEntity(shown, id)) {
		return {
			addEntity,
			insertBeat: {
				after: index,
				index: index + 1,
				owner:
					shown && (shown.kind === 'say' || shown.kind === 'set')
						? shown.who
						: undefined
			},
			targets: []
		};
	}

	// `EntityTarget.beat` indexes the YAML `beats:` sequence, `scene.beats` skips items the
	// parser rejected. They agree unless the block has a malformed beat, and `locateEntity`
	// checks the speaker id before writing, so a disagreement writes nothing rather than
	// writing into the wrong beat.
	return {addEntity, targets: [{beat: index, id, kind}]};
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
	/**
	 * What to write instead of removing, when the write lands on a BEAT.
	 *
	 * A beat that does not mention a key inherits whatever the beat before it left, so
	 * "unflip" cannot be said there by deleting something — there is usually nothing on that
	 * line to delete, and the deletion would fall through to the `cast:` entry and unflip
	 * the character for the whole scene. On a beat the explicit opposite (`flip: false`,
	 * `scale: 1`) is the only honest way to write it.
	 *
	 * At scrubber 0 the removal still wins: the entry is the top of the scene, nothing
	 * inherits from it, and `flip: false` there is just noise.
	 */
	reset?: unknown;
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

/**
 * A bubble dragged or resized on the stage.
 *
 * Addressed by beat rather than by entity: the same character can speak twice in a scene
 * with the bubble parked somewhere else each time, so the line is what owns the geometry.
 * `beat` is an index into `scene.beats`, i.e. the scrubber position minus one.
 */
export interface BubbleWrite {
	bubble: BubbleGeometry;
	beat: number;
}

/**
 * A key on the beat itself — `dur:` today.
 *
 * Addressed by beat index like `BubbleWrite`, and for the same reason: timing belongs to the
 * moment, not to whoever happens to be speaking in it. A beat with no speaker at all
 * (`- box: {…}`) still has a duration.
 *
 * Deliberately NOT an `EntityKeyWrite` with a `beat` target: that route goes through
 * `planEntityWrite`, which refuses a beat the entity does not own — right for a sprite's
 * position, wrong for a property of the beat.
 */
export interface BeatKeyWrite {
	beat: number;
	beatKey: string;
	/** `null` REMOVES the key. `undefined` is not a value — filter it out before writing. */
	value: unknown;
}

export type SceneWrite =
	| BeatKeyWrite
	| BubbleWrite
	| EntityKeyWrite
	| EntityStructWrite
	| SceneKeyWrite;

export function isSceneKeyWrite(write: SceneWrite): write is SceneKeyWrite {
	return 'sceneKey' in write;
}

export function isBubbleWrite(write: SceneWrite): write is BubbleWrite {
	return 'bubble' in write;
}

export function isBeatKeyWrite(write: SceneWrite): write is BeatKeyWrite {
	return 'beatKey' in write;
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

/**
 * The keys a group of writes puts on ONE new beat.
 *
 * Pooled rather than written one at a time because a drag that changed both `at` and `scale`
 * is one move: asked separately, each would splice a beat of its own and the author would
 * get two lines for one gesture.
 */
function insertBeatEdit(
	context: SceneWriteContext,
	index: number,
	writes: EntityKeyWrite[]
): TextEdit | undefined {
	const {blockText} = context;
	const first = writes[0];

	if (!first) {
		return undefined;
	}

	const keys: Record<string, unknown> = {};

	for (const write of writes) {
		// A new beat inherits whatever the beat before it left, so "unset" cannot be said
		// there by leaving a key out — the explicit opposite is the only honest form, and a
		// write with neither a value nor a reset has nothing to say at all.
		const value = write.value === undefined ? write.reset : write.value;

		if (value !== undefined) {
			keys[write.key] = value;
		}
	}

	return insertBeatEntity(blockText, index, first.id, keys, {
		relative: entityHasParent(blockText, {id: first.id, kind: first.kind})
	});
}

/** One write's edit, or undefined when there is nowhere sane to put it. */
export function buildEntityEdit(
	context: SceneWriteContext,
	write: EntityKeyWrite
): TextEdit | undefined {
	const {blockText, beat, scene} = context;
	const plan = planEntityWrite(scene, beat, write.kind, write.id);

	if (plan.insertBeat) {
		return insertBeatEdit(context, plan.insertBeat.index, [write]);
	}

	for (const target of plan.targets) {
		// On a beat, "unset" is written as the explicit opposite rather than as a deletion:
		// a beat inherits every key it does not mention, so there is nothing to delete and a
		// deletion would land on the entry instead.
		const value =
			write.value === undefined && target.beat !== undefined
				? write.reset
				: write.value;
		const edit =
			value === undefined
				? removeEntityKey(blockText, target, write.key)
				: setEntityKey(blockText, target, write.key, value);

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
	if (isBeatKeyWrite(write)) {
		return setBeatKey(
			context.blockText,
			write.beat,
			write.beatKey,
			write.value
		);
	}

	if (isBubbleWrite(write)) {
		return setBeatBubble(context.blockText, write.beat, write.bubble);
	}

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
	// Insertion order, so a multi-select drag writes its new beats in the order the entities
	// were picked rather than in map order — every insert lands on the same offset, and
	// `mergeEdits` concatenates same-offset inserts in the order it is handed them.
	const inserted = new Map<EntityId, {index: number; writes: EntityKeyWrite[]}>();

	for (const write of writes) {
		if (
			!isBeatKeyWrite(write) &&
			!isBubbleWrite(write) &&
			isStructWrite(write) &&
			write.struct === 'remove'
		) {
			removed.set(write.kind, [...(removed.get(write.kind) ?? []), write.id]);
			continue;
		}

		if (
			!isBeatKeyWrite(write) &&
			!isBubbleWrite(write) &&
			!isSceneKeyWrite(write) &&
			!isStructWrite(write)
		) {
			const plan = planEntityWrite(
				context.scene,
				context.beat,
				write.kind,
				write.id
			);

			if (plan.insertBeat) {
				const group = inserted.get(write.id) ?? {
					index: plan.insertBeat.index,
					writes: []
				};

				group.writes.push(write);
				inserted.set(write.id, group);
				continue;
			}
		}

		const edit = buildWriteEdit(context, write);

		if (edit) {
			edits.push(edit);
		}
	}

	for (const {index, writes: group} of inserted.values()) {
		const edit = insertBeatEdit(context, index, group);

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
 * How many new beats this gesture will splice in — what the scrubber has to step forward by
 * to keep showing the moment the author is looking at.
 *
 * Counted from the plan rather than from the edits, so the caller can ask before writing and
 * decide what the scrubber does once the write lands.
 */
export function insertedBeatCount(
	context: SceneWriteContext,
	writes: SceneWrite[]
): number {
	const ids = new Set<EntityId>();

	for (const write of writes) {
		if (
			isBeatKeyWrite(write) ||
			isBubbleWrite(write) ||
			isSceneKeyWrite(write) ||
			isStructWrite(write)
		) {
			continue;
		}

		if (
			planEntityWrite(context.scene, context.beat, write.kind, write.id)
				.insertBeat
		) {
			ids.add(write.id);
		}
	}

	return ids.size;
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
	[id: string]: {at?: {x: number; y: number}; rot?: number; scale?: number};
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
			...(patch[id].rot === undefined ? {} : {rot: patch[id].rot as number}),
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
	actual: {at: {x: number; y: number}; rot?: number; scale: number} | undefined
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

	// Absent and 0 are the same rotation, so a patch that levelled a sprite has to settle
	// against an entity that simply has no `rot` key any more — which is exactly what the
	// write produces, since coming back to 0 deletes it.
	if (
		patched.rot !== undefined &&
		Math.abs(patched.rot - (actual.rot ?? 0)) > AGREE_EPSILON
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
	entities: Record<
		string,
		{at: {x: number; y: number}; rot?: number; scale: number}
	>
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
