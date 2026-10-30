/**
 * The rules behind phase 4's gestures (spec 10): flip, z, pose, delete, drop, camera.
 *
 * Pure, like `planEntityWrite` and for the same reason — "does `f` on an unflipped sprite
 * write `flip: true` or delete the key" is a rule, and a rule that can only be checked by
 * pressing a key in a browser is a rule nobody checks. Nothing here touches the DOM, React
 * or the document; every function turns the stage the author is looking at into writes that
 * `writeSceneEdits` splices in one go.
 *
 * The text stays the source of truth: each of these READS the current value out of the
 * parsed stage and produces the next one, so repeated presses cannot accumulate drift.
 */

import {entityKey} from '@sliders/asset-store';
import {formatValue} from '@sliders/scene-edit';
import {resolveZ} from '@sliders/render-dom';
import type {StageBox} from '@sliders/render-dom';
import {beatParts, mergeEmit} from '@sliders/scene-types';
import type {
	EmitPatch,
	Camera,
	EntityFit,
	EntityId,
	EntityPatch,
	PoseLoop,
	Scene,
	Stage,
	StageEntity,
	Vec2
} from '@sliders/scene-types';
import type {AssetDragPayload} from './asset-drag';
import {mountToScene, roundCoord} from './stage-geometry';
import type {
	EntityKeyWrite,
	EntityStructWrite,
	SceneKeyWrite,
	SceneWrite
} from './use-scene-writer';

/**
 * One bracket press, in the 0..1 space `resolveZ` derives from y. A tenth is coarse enough
 * to reorder two sprites standing on the same line and fine enough not to jump the whole
 * stage's worth of depth in one tap.
 */
export const Z_STEP = 0.1;

/** Camera zoom bounds. Past these the stage is either a pixel or a texture. */
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 8;

/** A camera at rest. Written as no `camera:` key at all. */
export const CAMERA_IDENTITY: Camera = {at: {x: 0, y: 0}, zoom: 1};

function entitiesOf(stage: Stage, ids: EntityId[]): StageEntity[] {
	return ids
		.map(id => stage?.entities?.[id])
		.filter((entity): entity is StageEntity => !!entity);
}

// ---------------------------------------------------------------------------
// flip
// ---------------------------------------------------------------------------

/**
 * Toggle `flip:` on everything selected.
 *
 * PER ENTITY, not "make them all match the first one": two characters facing each other are
 * a composition, and a group toggle would turn it into two characters facing the same way.
 *
 * Returning to false DELETES the key, exactly as `scale: 1` does — `flip: false` is the
 * default written out longhand, which is noise in a file people hand-edit. (In a `from:`
 * scene an absent key means inherited rather than default, so this can un-flip an
 * inherited flip; that is the same trade `scale:` already makes, and the alternative —
 * leaving `flip: false` behind forever — is worse to read.)
 */
export function flipWrites(stage: Stage, ids: EntityId[]): EntityKeyWrite[] {
	return entitiesOf(stage, ids).map(entity => ({
		id: entity.id,
		key: 'flip',
		kind: entity.kind,
		ref: entity.ref,
		// Unflipping deletes the key on the entry, but has to SAY `flip: false` on a beat —
		// a beat inherits whatever the one before it left.
		reset: false,
		value: entity.flip ? undefined : true
	}));
}

/**
 * Back to the art's own aspect: the squeeze is dropped, `scale:` stays. Deletes the key on
 * the entry and says `stretch: [1, 1]` on a beat, the way unflipping does.
 */
export function unstretchWrites(
	stage: Stage,
	ids: EntityId[]
): EntityKeyWrite[] {
	return entitiesOf(stage, ids)
		.filter(entity => isStretched(entity))
		.map(entity => ({
			id: entity.id,
			key: 'stretch',
			kind: entity.kind,
			ref: entity.ref,
			reset: [1, 1],
			value: undefined
		}));
}

/** Drawn at some other aspect than the art's own. */
export function isStretched(entity: StageEntity | undefined): boolean {
	const stretch = entity?.stretch;

	return !!stretch && (stretch.x !== 1 || stretch.y !== 1);
}

/**
 * Lock or unlock: all locked when any was not, otherwise all unlocked. Always on the
 * entry — `locked:` is an editor setting, not a moment of the scene.
 */
export function lockWrites(stage: Stage, ids: EntityId[]): EntityKeyWrite[] {
	const entities = entitiesOf(stage, ids);
	const lock = !entities.every(entity => entity.locked);

	return entities.map(entity => ({
		entry: true,
		id: entity.id,
		key: 'locked',
		kind: entity.kind,
		ref: entity.ref,
		value: lock ? true : undefined
	}));
}

// ---------------------------------------------------------------------------
// z
// ---------------------------------------------------------------------------

/**
 * Nudge `z:`. One space for the whole stage — a step can carry a sprite past anything.
 *
 * An entity with no `z:` is ordered by its y (`resolveZ`), so the first press has to start
 * from that derived value — starting from 0 would teleport a character behind everything on
 * the floor. After that the explicit number is what gets read back, so presses accumulate
 * in the text rather than in memory.
 */
export function zWrites(
	stage: Stage,
	ids: EntityId[],
	delta: number
): EntityKeyWrite[] {
	return entitiesOf(stage, ids).map(entity => ({
		id: entity.id,
		key: 'z',
		kind: entity.kind,
		ref: entity.ref,
		value: roundCoord(resolveZ(entity) + delta * Z_STEP)
	}));
}

// ---------------------------------------------------------------------------
// opacity
// ---------------------------------------------------------------------------

/**
 * Set `opacity:` on everything selected, clamped to 0..1 and kept to two places — a slider
 * dragged to 0.3000000004 should not write that. Fully opaque deletes the key on the entry
 * and says `opacity: 1` on a beat, the way unflipping does.
 */
export function opacityWrites(
	stage: Stage,
	ids: EntityId[],
	opacity: number
): EntityKeyWrite[] {
	const value = Math.round(Math.min(1, Math.max(0, opacity)) * 100) / 100;

	return entitiesOf(stage, ids).map(entity => ({
		id: entity.id,
		key: 'opacity',
		kind: entity.kind,
		ref: entity.ref,
		reset: 1,
		value: value === 1 ? undefined : value
	}));
}

// ---------------------------------------------------------------------------
// pose
// ---------------------------------------------------------------------------

/**
 * Pick a named pose. Not for props — a prop is a single image and has no poses (spec 03).
 * An `auto` entity is allowed through: only the pose select can call this, and that is
 * only on screen when the resolver actually found a character with poses.
 *
 * An empty choice removes the key: the renderer then falls back to `idle`, or to the first
 * pose in the manifest, which is a better default than any name this could write.
 *
 * Always writes `pose:`. An entity still spelled `frame:` is renamed in the same edit
 * (`setEntityKey` finds the old spelling), so the text never holds both.
 */
export function poseWrite(
	entity: StageEntity | undefined,
	pose: string | undefined
): EntityKeyWrite | undefined {
	if (!entity || entity.kind === 'prop') {
		return undefined;
	}

	return {
		id: entity.id,
		key: 'pose',
		kind: entity.kind,
		ref: entity.ref,
		value: pose ? pose : undefined
	};
}

/**
 * Set or stop `motion:` on everything selected. Stopping deletes the key on the entry and
 * says `motion: ~` on a beat — a beat inherits the motion the one before it left.
 *
 * Changing the token keeps each entity's own `speed`: a parallax stack is several layers
 * at different speeds, and picking a new direction for all of them should not flatten it.
 */
export function motionWrites(
	stage: Stage,
	ids: EntityId[],
	motion: string | undefined
): EntityKeyWrite[] {
	return entitiesOf(stage, ids).map(entity => ({
		id: entity.id,
		key: 'motion',
		kind: entity.kind,
		ref: entity.ref,
		reset: null,
		value: motion ? {id: motion, speed: entity.motion?.speed} : undefined
	}));
}

/**
 * Set or clear `speed` (seconds per cycle) on every selected sprite that HAS a motion. A
 * still sprite has nothing to time, and a bare speed is not a key the parser takes.
 * `undefined` goes back to the preset's own loop length — the token alone.
 */
export function motionSpeedWrites(
	stage: Stage,
	ids: EntityId[],
	speed: number | undefined
): EntityKeyWrite[] {
	return entitiesOf(stage, ids).flatMap(entity =>
		entity.motion
			? [
					{
						id: entity.id,
						key: 'motion',
						kind: entity.kind,
						ref: entity.ref,
						value: {id: entity.motion.id, speed}
					}
			  ]
			: []
	);
}

/**
 * Set or clear `fit:` on everything selected. `undefined` = a sprite again (key removed).
 *
 * Always on the entry. There is no `fit: ~` (`mergePatch`): a beat can turn a sprite into a
 * plane but never back, so a write that followed the scrubber could set what it could not
 * undo. Drawing mode is the entity's, not a moment's.
 */
export function fitWrites(
	stage: Stage,
	ids: EntityId[],
	fit: EntityFit | undefined
): EntityKeyWrite[] {
	return entitiesOf(stage, ids).map(entity => ({
		entry: true,
		id: entity.id,
		key: 'fit',
		kind: entity.kind,
		ref: entity.ref,
		value: fit
	}));
}

/**
 * Set or clear `poseLoop:` on every selected character playing an inline step list. Props
 * have no poses, and on a single pose the key means nothing.
 *
 * Clearing deletes the key on the entry and says `poseLoop: all` on a beat — the default
 * spelled out, since a beat inherits the loop the one before it left.
 */
export function poseLoopWrites(
	stage: Stage,
	ids: EntityId[],
	poseLoop: PoseLoop | undefined
): EntityKeyWrite[] {
	return entitiesOf(stage, ids)
		.filter(entity => entity.kind !== 'prop' && entity.steps)
		.map(entity => ({
			id: entity.id,
			key: 'poseLoop',
			kind: entity.kind,
			ref: entity.ref,
			reset: 'all',
			value: poseLoop
		}));
}

/**
 * Set or clear an entity's `if:` on everything selected. Always on the entry: on a beat
 * `if:` gates the whole BEAT (the parser warns), so the entity's own condition only exists
 * in `cast:` / `props:`.
 */
export function conditionWrites(
	stage: Stage,
	ids: EntityId[],
	condition: string | undefined
): EntityKeyWrite[] {
	return entitiesOf(stage, ids).map(entity => ({
		entry: true,
		id: entity.id,
		key: 'if',
		kind: entity.kind,
		ref: entity.ref,
		value: condition
	}));
}

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

/**
 * Delete everything selected. Whether that removes the entry or rewrites it as `id: ~` is
 * decided by `from:` at write time — see `buildWriteEdit`. `withBeats` takes their beat
 * parts too.
 */
export function deleteWrites(
	stage: Stage,
	ids: EntityId[],
	withBeats = false
): EntityStructWrite[] {
	return entitiesOf(stage, ids).map(entity => ({
		id: entity.id,
		kind: entity.kind,
		struct: 'remove' as const,
		...(withBeats ? {withBeats} : {})
	}));
}

/** Which of these ids any beat in the scene names — a part of its own, spoken or not. */
export function idsWithBeats(scene: Scene | undefined, ids: EntityId[]): EntityId[] {
	const named = new Set<EntityId>();

	for (const beat of scene?.beats ?? []) {
		for (const part of beatParts(beat)) {
			named.add(part.who);
		}
	}

	return ids.filter(id => named.has(id));
}

// ---------------------------------------------------------------------------
// dropping an asset
// ---------------------------------------------------------------------------

/**
 * An id no other entity in the block is using.
 *
 * Ids are the key of one map per kind, so a collision does not error — it silently
 * OVERWRITES the entry that was there, and the author loses a character to a drop. The
 * suffix counts from 2 because `mira` and `mira-2` is how a person would number them.
 */
export function uniqueEntityId(base: string, taken: EntityId[]): EntityId {
	const root = base || 'entity';

	if (!taken.includes(root)) {
		return root;
	}

	let n = 2;

	while (taken.includes(`${root}-${n}`)) {
		n++;
	}

	return `${root}-${n}`;
}

/**
 * What a drop from the asset panel writes.
 *
 * A background replaces `bg:`, a sound replaces `music:` (same rule as a sound FILE drop,
 * `musicDropWrites`); anything else becomes a new entry positioned where it landed. `ref` is written verbatim — it is already the NAME (or character id) the payload
 * promised — and `addEntity` drops it again when it happens to equal the derived id, so the
 * common `mira: {at: 0}` case stays clean while `candle: {ref: props/candle, at: 0}` keeps
 * the pointer it needs.
 */
export function assetDropWrites(
	payload: AssetDragPayload,
	at: Vec2,
	taken: EntityId[]
): SceneWrite[] {
	if (payload.target === 'bg') {
		return [{formatted: formatValue('bg', payload.ref), sceneKey: 'bg'}];
	}

	if (payload.target === 'music') {
		return musicDropWrites(payload.ref);
	}

	const kind = payload.target === 'cast' ? 'cast' : 'prop';
	// `entityKey` is the asset manager's own rule for turning a name into a YAML key
	// (`props/candle` -> `candle`), reused rather than re-derived so a dropped prop lands
	// under the same id the tile's copyable fragment offers.
	const id = uniqueEntityId(entityKey(payload.ref), taken);

	return [
		{
			id,
			kind,
			patch: {
				at: {x: roundCoord(at.x), y: roundCoord(at.y)},
				kind,
				ref: payload.ref
			} as EntityPatch,
			struct: 'add' as const
		}
	];
}

/**
 * What a sound FILE dropped on the stage writes: the scene's own `music:`, replaced whole.
 *
 * Scene top, not a beat: a drop is "this scene sounds like this", and the scrubber's
 * position is incidental to that. Replaced rather than merged into a keyed map, because the
 * author who drops one file means "this one" — a second track is a deliberate thing typed
 * by hand, and guessing a key for it would invent a name they never chose. The single form
 * is the bed (`MUSIC_MAIN_TRACK`, looping), which is what a dropped file is nine times in ten.
 */
export function musicDropWrites(name: string): SceneWrite[] {
	return [{formatted: formatValue('music', name), sceneKey: 'music'}];
}

// ---------------------------------------------------------------------------
// camera
// ---------------------------------------------------------------------------

function clampZoom(zoom: number): number {
	if (!Number.isFinite(zoom)) {
		return 1;
	}

	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function isDefaultCamera(camera: Camera | undefined): boolean {
	return (
		!camera ||
		(roundCoord(camera.at?.x ?? 0) === 0 &&
			roundCoord(camera.at?.y ?? 0) === 0 &&
			roundCoord(camera.zoom ?? 1) === 1)
	);
}

/**
 * `{at: [x, y], zoom: z}`, with the parts that are at rest left out.
 *
 * `at` is always a pair, never the bare number `at:` accepts for an entity: a bare number
 * means "y at the layer baseline" (spec 02), which for a camera is a pan halfway down the
 * stage rather than the centre it was meant to say.
 */
export function formatCamera(camera: Camera): string {
	const parts: string[] = [];
	const x = roundCoord(camera.at?.x ?? 0);
	const y = roundCoord(camera.at?.y ?? 0);
	const zoom = roundCoord(camera.zoom ?? 1);

	if (x !== 0 || y !== 0) {
		parts.push(`at: [${x}, ${y}]`);
	}

	if (zoom !== 1) {
		parts.push(`zoom: ${zoom}`);
	}

	return `{${parts.join(', ')}}`;
}

/** The `camera:` write. A camera back at rest deletes the key rather than writing it out. */
export function cameraWrite(camera: Camera): SceneKeyWrite {
	return {
		formatted: isDefaultCamera(camera) ? undefined : formatCamera(camera),
		sceneKey: 'camera'
	};
}

/**
 * Pan so that the scene point the drag started on stays under the pointer.
 *
 * Both pointers are inverted through the START camera, so the delta is in scene units and
 * the camera's own `at` cancels out of the subtraction — panning cannot feed back into
 * itself as the camera moves under the pointer mid-drag.
 */
export function panCamera(
	box: StageBox,
	startCamera: Camera,
	startPointer: Vec2,
	pointer: Vec2
): Camera {
	const a = mountToScene(box, startCamera, startPointer);
	const b = mountToScene(box, startCamera, pointer);

	return {
		at: {
			x: roundCoord((startCamera.at?.x ?? 0) - (b.x - a.x)),
			y: roundCoord((startCamera.at?.y ?? 0) - (b.y - a.y))
		},
		zoom: clampZoom(startCamera.zoom ?? 1)
	};
}

/**
 * Zoom about the pointer: whatever is under the cursor stays under the cursor.
 *
 * `mountToScene` is affine in the camera's `at` — the camera offset lands in scene space
 * one for one — so the correction is the difference between where this pixel maps at the
 * old zoom and the new one, both measured with the camera at the origin.
 */
export function zoomCamera(
	box: StageBox,
	camera: Camera,
	pointer: Vec2,
	factor: number
): Camera {
	const from = clampZoom(camera.zoom ?? 1);
	const to = clampZoom(from * (Number.isFinite(factor) ? factor : 1));
	const at = camera.at ?? {x: 0, y: 0};

	if (to === from) {
		return {at: {x: at.x, y: at.y}, zoom: from};
	}

	const before = mountToScene(box, {at: {x: 0, y: 0}, zoom: from}, pointer);
	const after = mountToScene(box, {at: {x: 0, y: 0}, zoom: to}, pointer);

	return {
		at: {
			x: roundCoord(at.x + before.x - after.x),
			y: roundCoord(at.y + before.y - after.y)
		},
		zoom: roundCoord(to)
	};
}

/**
 * A wheel notch to a zoom factor.
 *
 * Exponential, so zooming in and back out by the same scroll distance returns to exactly
 * where it started, and `deltaMode` is honoured because a mouse wheel reports lines while a
 * trackpad reports pixels — treating a line as a pixel makes a real wheel almost inert.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
	if (!Number.isFinite(deltaY) || deltaY === 0) {
		return 1;
	}

	const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;

	return Math.exp(-Math.max(-400, Math.min(400, pixels)) * 0.0025);
}

/**
 * Merge `patch` into the selected emitter's `emit:`. Writes the WHOLE merged map: on a beat
 * it merges over the one before, so restating inherited keys changes nothing. `null` (or a
 * patch that leaves every key at the asset's own value) removes the key.
 */
/**
 * Swap the particle system: the entry's `ref:`. Entry, not beat -- which emitter it is
 * belongs to the whole scene; `emit:` overrides stay and now sit over the new defaults.
 */
export function emitterRefWrites(
	stage: Stage,
	ids: EntityId[],
	name: string
): EntityKeyWrite[] {
	return entitiesOf(stage, ids).map(entity => ({
		entry: true,
		id: entity.id,
		key: 'ref',
		kind: entity.kind,
		ref: name,
		value: name
	}));
}

export function emitWrites(
	stage: Stage,
	ids: EntityId[],
	patch: EmitPatch | null
): EntityKeyWrite[] {
	return entitiesOf(stage, ids).map(entity => ({
		id: entity.id,
		key: 'emit',
		kind: entity.kind,
		ref: entity.ref,
		reset: null,
		value: patch === null ? undefined : mergeEmit(entity.emit, patch)
	}));
}
