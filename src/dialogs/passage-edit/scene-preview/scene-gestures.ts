/**
 * The rules behind phase 4's gestures (spec 09): flip, layer, z, frame, delete, drop, camera.
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
import {LAYERS} from '@sliders/scene-types';
import type {
	Camera,
	EntityId,
	EntityPatch,
	Layer,
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
 * to reorder two sprites standing on the same line and fine enough not to jump a whole
 * layer's worth of depth in one tap.
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
		value: entity.flip ? undefined : true
	}));
}

// ---------------------------------------------------------------------------
// layer
// ---------------------------------------------------------------------------

/** One step towards `front` (+1) or `back` (-1). Clamped: the set is fixed (D11). */
export function nextLayer(layer: Layer, delta: number): Layer {
	const index = LAYERS.indexOf(layer);
	const from = index === -1 ? LAYERS.indexOf('mid') : index;

	return LAYERS[Math.min(LAYERS.length - 1, Math.max(0, from + delta))];
}

/**
 * Put everything selected on one layer.
 *
 * `layer: mid` is written out even though it is the default, unlike `flip` and `scale`:
 * a layer only ever changes because the author asked for a specific one, and in a `from:`
 * scene an absent `layer:` inherits — dropping the key would silently hand the entity back
 * whatever the base scene said instead of the mid layer that was just asked for.
 */
export function layerWrites(
	stage: Stage,
	ids: EntityId[],
	layer: Layer
): EntityKeyWrite[] {
	return entitiesOf(stage, ids)
		.filter(entity => entity.layer !== layer)
		.map(entity => ({
			id: entity.id,
			key: 'layer',
			kind: entity.kind,
			ref: entity.ref,
			value: layer
		}));
}

/**
 * Send to back / bring to front, one layer at a time.
 *
 * Per entity rather than "everything to the layer the first one lands on": a selection
 * spread across two layers is spread on purpose, and one keypress should move the whole
 * group by one step, not flatten it.
 */
export function layerStepWrites(
	stage: Stage,
	ids: EntityId[],
	delta: number
): EntityKeyWrite[] {
	const writes: EntityKeyWrite[] = [];

	for (const entity of entitiesOf(stage, ids)) {
		writes.push(...layerWrites(stage, [entity.id], nextLayer(entity.layer, delta)));
	}

	return writes;
}

// ---------------------------------------------------------------------------
// z
// ---------------------------------------------------------------------------

/**
 * Nudge `z:` within the layer.
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
// frame
// ---------------------------------------------------------------------------

/**
 * Pick a named frame. Cast only — props are a single image and have no frames (spec 03).
 *
 * An empty choice removes the key: the renderer then falls back to `idle`, or to the first
 * frame in the manifest, which is a better default than any name this could write.
 */
export function frameWrite(
	entity: StageEntity | undefined,
	frame: string | undefined
): EntityKeyWrite | undefined {
	if (!entity || entity.kind !== 'cast') {
		return undefined;
	}

	return {
		id: entity.id,
		key: 'frame',
		kind: entity.kind,
		ref: entity.ref,
		value: frame ? frame : undefined
	};
}

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

/**
 * Delete everything selected. Whether that removes the entry or rewrites it as `id: ~` is
 * decided by `from:` at write time — see `buildWriteEdit`.
 */
export function deleteWrites(
	stage: Stage,
	ids: EntityId[]
): EntityStructWrite[] {
	return entitiesOf(stage, ids).map(entity => ({
		id: entity.id,
		kind: entity.kind,
		struct: 'remove' as const
	}));
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
 * A background replaces `bg:`; anything else becomes a new entry positioned where it
 * landed. `ref` is written verbatim — it is already the NAME (or character id) the payload
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
