/**
 * The rules behind the layers panel: which rows it lists, in what order, and what a drag or
 * a "back to auto" writes.
 *
 * Pure, like `scene-gestures.ts` and for the same reason — "where does a row dropped between
 * two sprites standing on the same line end up" is a rule, and one that can only be checked
 * by dragging in a browser is one nobody checks. Nothing here touches the DOM or React.
 *
 * The one invariant everything below serves: THE PANEL ORDER IS THE DRAW ORDER. Not "close
 * to it" — the panel is how an author finds the sprite hidden behind a wall, and a list that
 * disagrees with the stage about who is in front is worse than no list. So the order is
 * computed by the renderer's own `sortByZ`, fed exactly what `DomRenderer.assignZ()` feeds
 * it:
 *
 * - `at` from the RESOLVED stage. The renderer draws `resolveStage(stage)`, so a child
 *   (`of:`) derives its z from its absolute y, not from the offset the author wrote.
 * - `z` with `FIT_Z` standing in for a plane that somehow has none (the parser always seeds
 *   one; a hand-built stage might not).
 * - `order` = position in `Object.keys(stage.entities)`, the insertion order `apply()`
 *   records. Exiting entities (`MAX_SAFE_INTEGER` there) are not in a stage at all, so they
 *   never reach the panel.
 *
 * "Auto" is the trap. The parser SEEDS `z` — `fit:` gets `FIT_Z`, `layer: back|front` gets
 * `LAYER_Z` — into the same `StageEntity.z` an author's own `z:` lands in, and the Stage
 * keeps no record of which was which. So the rule here is: any number in `z` is PINNED,
 * with one exception — a plane whose z is exactly `FIT_Z` counts as auto, because that is
 * the value removing its `z:` gives back, so there is nothing for "back to auto" to do. A
 * `layer: back|front` sprite therefore reads as pinned. Its reset is offered disabled
 * (`zResetBlocks` asks the writer, which finds no `z:` to drop) rather than as a button
 * that does nothing; telling the two apart in the stage itself would need the parser to
 * carry a flag.
 */

import {sortByZ} from '@sliders/render-dom';
import {resolveStage} from '@sliders/scene-core';
import {FIT_Z} from '@sliders/scene-types';
import type {
	Beat,
	EntityId,
	EntityKind,
	SayBeat,
	Scene,
	SetBeat,
	Stage,
	StageEntity
} from '@sliders/scene-types';
import {Z_STEP} from './scene-gestures';
import {roundCoord} from './stage-geometry';
import {beatOwnsEntity, type EntityKeyWrite} from './use-scene-writer';

export interface LayerRow {
	id: EntityId;
	/** As declared — `auto` for an `entities:` entry the resolver has not looked at. */
	kind: EntityKind;
	ref: string;
	/** Resolved: explicit (or seeded) z, otherwise derived from the absolute y. */
	z: number;
	/** No explicit z, so it follows y. See the module comment for what "explicit" can mean. */
	auto: boolean;
	/** `fit:` set — a full-bleed plane rather than a sprite. */
	plane: boolean;
	locked: boolean;
	/** `of`, as the author wrote it. */
	parent?: EntityId;
}

/** A row plus what the sort needs and the panel does not. */
interface Ranked {
	row: LayerRow;
	entity: StageEntity;
	order: number;
}

function isAuto(entity: StageEntity): boolean {
	if (typeof entity.z !== 'number' || !Number.isFinite(entity.z)) {
		return true;
	}

	return !!entity.fit && entity.z === FIT_Z;
}

/** Every entity, BACK first — the order `sortByZ` hands back and the renderer paints in. */
function rankBackFirst(stage: Stage): Ranked[] {
	const entities = stage?.entities ?? {};
	const resolved = resolveStage(stage)?.entities ?? entities;
	const items = Object.keys(entities)
		.map((id, order) => ({entity: entities[id], id, order}))
		.filter(item => !!item.entity)
		.map(({entity, id, order}) => {
			const at = resolved[id]?.at ?? entity.at ?? {x: 0, y: 0};
			const z = entity.fit ? entity.z ?? FIT_Z : entity.z;

			return {at, entity, id, order, z};
		});

	return sortByZ(items).map(({at, entity, id, order, z}) => ({
		entity,
		order,
		row: {
			auto: isAuto(entity),
			id,
			kind: entity.kind,
			locked: !!entity.locked,
			plane: !!entity.fit,
			ref: entity.ref,
			// Same arithmetic as render-dom's `resolveZ`, which `sortByZ` just ranked on.
			z:
				typeof z === 'number' && Number.isFinite(z) ? z : (1 - (at.y ?? 0)) / 2,
			...(entity.of !== undefined ? {parent: entity.of} : {})
		}
	}));
}

/** Front-most FIRST (top of panel = drawn last). Same order the renderer draws. */
export function layerRows(stage: Stage): LayerRow[] {
	return rankBackFirst(stage)
		.map(item => item.row)
		.reverse();
}

// ---------------------------------------------------------------------------
// reorder
// ---------------------------------------------------------------------------

/**
 * Decimal places tried, coarse first. 3 is `roundCoord`'s, the precision every other
 * gesture writes, so the common drop reads like a number a person would type. Finer only
 * when 3 places cannot separate the neighbours — the alternative, renumbering them, turns
 * one drag into a diff across half the scene.
 */
const PRECISIONS = [3, 4, 5, 6, 8, 10, 12];

function roundTo(n: number, places: number): number {
	if (places === 3) {
		return roundCoord(n);
	}

	const f = 10 ** places;
	const rounded = Math.round(n * f) / f;

	return rounded === 0 ? 0 : rounded;
}

/**
 * Raw z for `count` moved rows dropped between `hi` (the rest row in front of the slot) and
 * `lo` (the one behind it), front-most moved row first.
 *
 * Between two neighbours: spread evenly, so one row lands on the midpoint and several get
 * equal gaps. At the top or bottom there is only one neighbour, so the rows stack outward
 * from it a `Z_STEP` apiece — one row lands exactly `Z_STEP` past it, same as a bracket
 * press. An empty rest (everything selected) never gets here: that is always a no-op.
 */
function spread(
	hi: number | undefined,
	lo: number | undefined,
	count: number
): number[] {
	return Array.from({length: count}, (_, i) => {
		if (hi === undefined) {
			return (lo as number) + Z_STEP * (count - i);
		}

		if (lo === undefined) {
			return hi - Z_STEP * (i + 1);
		}

		return hi - ((hi - lo) * (i + 1)) / (count + 1);
	});
}

/** Front-first ids `sortByZ` would produce if `moved` took these z values. */
function drawnOrder(
	ranked: Ranked[],
	values: Map<EntityId, number>
): EntityId[] {
	const items = ranked.map(({row, order}) => ({
		at: {x: 0, y: 0},
		id: row.id,
		order,
		z: values.has(row.id) ? values.get(row.id) : row.z
	}));

	return sortByZ(items)
		.map(item => item.id)
		.reverse();
}

function sameIds(a: EntityId[], b: EntityId[]): boolean {
	return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Z values that make the stage draw `rest` with `moved` inserted at `slot`, or undefined.
 *
 * Every candidate is CHECKED by running the real sort over it, rather than trusted because
 * it is "strictly between". That one check covers both hard cases with no special code:
 *
 * - Rounding collision: between 0.1001 and 0.1002 the midpoint rounds to 0.1 at three
 *   places and onto 0.1001 at four, so the next precision is tried, and the next.
 * - Equal neighbours: two rows tied at z 0.4 have no number strictly between them, and the
 *   spread is then 0.4 itself. Whether that works depends on insertion order — a moved row
 *   listed after the back neighbour and before the front one sorts between them at the same
 *   z — and the sort says yes or no.
 */
function solveSlot(
	ranked: Ranked[],
	rest: Ranked[],
	moved: Ranked[],
	slot: number
): Map<EntityId, number> | undefined {
	const hi = slot > 0 ? rest[slot - 1].row.z : undefined;
	const lo = slot < rest.length ? rest[slot].row.z : undefined;
	const raw = spread(hi, lo, moved.length);
	const want = [
		...rest.slice(0, slot).map(r => r.row.id),
		...moved.map(r => r.row.id),
		...rest.slice(slot).map(r => r.row.id)
	];

	// Two passes. The first insists on STRICT separation — every value strictly inside the
	// neighbours and strictly below the one before it — because an order that leans on an
	// insertion-order tie flips the day someone reorders the scene's keys. Only when no
	// precision gets there (equal neighbours) is a tie the sort happens to resolve right
	// accepted.
	for (const strict of [true, false]) {
		for (const places of [...PRECISIONS, undefined]) {
			const list = raw.map(v =>
				places === undefined ? v : roundTo(v, places)
			);
			const separated = list.every(
				(v, i) =>
					(hi === undefined || v < hi) &&
					(lo === undefined || v > lo) &&
					(i === 0 || v < list[i - 1])
			);

			if (strict && !separated) {
				continue;
			}

			const values = new Map(moved.map((r, i) => [r.row.id, list[i]]));

			if (sameIds(drawnOrder(ranked, values), want)) {
				return values;
			}
		}
	}

	return undefined;
}

/**
 * Move `ids` (keep their relative order) so they sit at `toIndex` in the CURRENT front-first
 * row list (index = insertion slot 0..rows.length, rows of moved ids excluded the usual
 * drag-and-drop way). Writes z ONLY for the moved entities: values strictly between new
 * neighbours (midpoint; spread several evenly), rounded with roundCoord but guaranteed to keep
 * strict order — if rounding collides, fall back to finer precision rather than renumbering
 * neighbours. Top slot = above front-most z (+Z_STEP), bottom slot = below back-most (-Z_STEP).
 * Returns [] for a no-op move.
 *
 * `toIndex` is a gap in the FULL list as the panel shows it — 0 above the first row,
 * `rows.length` below the last — and the moved rows' own gaps collapse, so dropping a row on
 * the gap just above or just below itself is a no-op. "Relative order" is the moved rows'
 * order in the panel now, not the order of `ids`: a selection is a set, and the order the
 * author clicked it in is not something they can see.
 *
 * The tie trap. When the slot falls INSIDE a run of rows sharing one z, and insertion order
 * will not put the moved rows where the drop said, no z written on the moved rows alone can
 * place them there — every value is either that z (sorted by insertion order, which said no)
 * or past the whole run. Rather than renumber the run, the drop SNAPS to the nearer edge of
 * the run (the front edge when both are equally near), and the moved rows sit just past it.
 * The panel re-reads the stage after the write, so the author sees where the rows actually
 * went; the fix for "I want it in the middle of that tie" is to pin one of the tied rows,
 * which is a choice about THEIR z and so is theirs to make.
 *
 * Locked rows move like any other: `locked:` stops the pointer picking a sprite up on the
 * stage, and the panel is how a locked sprite is reached at all.
 */
export function reorderWrites(
	stage: Stage,
	ids: EntityId[],
	toIndex: number
): EntityKeyWrite[] {
	const ranked = rankBackFirst(stage).reverse();
	const wanted = new Set(ids);
	const moved = ranked.filter(r => wanted.has(r.row.id));
	const rest = ranked.filter(r => !wanted.has(r.row.id));

	if (moved.length === 0 || rest.length === 0) {
		return [];
	}

	const gap = Math.max(
		0,
		Math.min(ranked.length, Math.round(Number.isFinite(toIndex) ? toIndex : 0))
	);
	let slot = ranked.slice(0, gap).filter(r => !wanted.has(r.row.id)).length;
	const current = ranked.map(r => r.row.id);
	const isNoop = (at: number) =>
		sameIds(current, [
			...rest.slice(0, at).map(r => r.row.id),
			...moved.map(r => r.row.id),
			...rest.slice(at).map(r => r.row.id)
		]);

	if (isNoop(slot)) {
		return [];
	}

	let values = solveSlot(ranked, rest, moved, slot);

	const tied =
		slot > 0 && slot < rest.length && rest[slot - 1].row.z === rest[slot].row.z;

	if (!values && tied) {
		// Inside a tie run that insertion order will not let us split. Find the run, snap to
		// its nearer edge. Both edges border a row with a DIFFERENT z (or the end of the
		// list), so a value strictly between always exists there.
		const z = rest[slot].row.z;
		let front = slot - 1;
		let back = slot;

		while (front > 0 && rest[front - 1].row.z === z) {
			front--;
		}

		while (back < rest.length && rest[back].row.z === z) {
			back++;
		}

		slot = slot - front <= back - slot ? front : back;

		if (isNoop(slot)) {
			return [];
		}

		values = solveSlot(ranked, rest, moved, slot);
	}

	if (!values) {
		return [];
	}

	const solved = values;

	return moved.map(({entity, row}) => ({
		id: row.id,
		key: 'z',
		kind: entity.kind,
		ref: entity.ref,
		value: solved.get(row.id)
	}));
}

// ---------------------------------------------------------------------------
// back to auto
// ---------------------------------------------------------------------------

/**
 * Remove explicit z from ids so they go back to y-derived. Only ids that have one.
 *
 * "Have one" is `!row.auto`, so the panel's auto badge and this agree by construction.
 *
 * A plain removal, no `reset`: there is no YAML spelling of "derive it" that a beat could
 * say instead (`z:` only takes a number). So the write lands only where the writer would
 * aim it — the entry at state 0, the beat on screen when it is this entity's own line — AND
 * only when that spot actually says `z:`. On somebody else's beat it goes nowhere (a new
 * beat with no keys is no beat), and an entry or beat that pins by `layer:` has no `z:` to
 * drop. Even a removal that lands may unpin nothing, when an earlier beat or the entry also
 * says `z:`. `zResetBlocks` is what tells the panel which of these it is.
 */
export function autoZWrites(stage: Stage, ids: EntityId[]): EntityKeyWrite[] {
	const wanted = new Set(ids);

	return rankBackFirst(stage)
		.reverse()
		.filter(({row}) => wanted.has(row.id) && !row.auto)
		.map(({entity, row}) => ({
			id: row.id,
			key: 'z',
			kind: entity.kind,
			ref: entity.ref,
			value: undefined
		}));
}

/**
 * Why a pinned row's reset would not make it auto:
 *
 * - `beat`: an earlier beat says `z:` — the one pinning it now, or one the removal here would
 *   only uncover.
 * - `entry`: the `cast:` / `props:` entry says it, and the scrubber is on a beat.
 * - `inherited`: nothing in this scene says it; it came in through `from:`.
 * - `seed`: the spot the writer would hit pins by `layer:`, not by a `z:` it could drop.
 */
export type ZResetBlock = 'beat' | 'entry' | 'inherited' | 'seed';

function beatSaysZ(beat: Beat | undefined, id: EntityId): boolean {
	return (
		beatOwnsEntity(beat, id) &&
		(beat as SayBeat | SetBeat).patch?.z !== undefined
	);
}

/**
 * Where a pinned row's z comes from, against where `planEntityWrite` would aim a removal.
 * Undefined when they are the same place and nothing behind it pins too.
 *
 * Read off the parsed scene rather than the stage: a beat's patch is the only record of
 * WHICH beat said `z:`, and the stage keeps just the result. `beat` is the scrubber index,
 * as for the writer; `opening` is state 0's entity, which is what is left once every beat's
 * `z:` is gone.
 */
export function zPinBlock(
	scene: Scene | undefined,
	beat: number,
	id: EntityId,
	opening: StageEntity | undefined
): Exclude<ZResetBlock, 'seed'> | undefined {
	const beats = scene?.beats ?? [];
	const index = beat - 1;
	const onBeat = index >= 0 && index < beats.length;
	const entrySaysZ = scene?.entities?.[id]?.z !== undefined;
	const openingPinned = !!opening && !isAuto(opening);
	let source = -1;

	for (let k = Math.min(index, beats.length - 1); k >= 0; k--) {
		if (beatSaysZ(beats[k], id)) {
			source = k;
			break;
		}
	}

	if (source >= 0) {
		// The writer only ever reaches the beat on screen, and only when it is this
		// entity's own line — `beatSaysZ` already asked the second.
		if (source !== index) {
			return 'beat';
		}

		for (let k = source - 1; k >= 0; k--) {
			if (beatSaysZ(beats[k], id)) {
				return 'beat';
			}
		}

		if (!openingPinned) {
			return undefined;
		}

		return entrySaysZ ? 'entry' : 'inherited';
	}

	if (!entrySaysZ) {
		return 'inherited';
	}

	return onBeat ? 'entry' : undefined;
}

/**
 * `zPinBlock` for every pinned row, then the writer's own word on the rest: `lands` builds
 * the edit and says whether it changes the text. A pin `zPinBlock` found nothing wrong with
 * and that still writes nothing is a `layer:` seed — the stage cannot tell one from a `z:`
 * (module comment), the text can.
 */
export function zResetBlocks(
	stage: Stage,
	scene: Scene | undefined,
	beat: number,
	opening: Stage | undefined,
	lands: (writes: EntityKeyWrite[]) => boolean
): Map<EntityId, ZResetBlock> {
	const blocks = new Map<EntityId, ZResetBlock>();

	for (const {row} of rankBackFirst(stage)) {
		if (row.auto) {
			continue;
		}

		const block =
			zPinBlock(scene, beat, row.id, opening?.entities?.[row.id]) ??
			(lands(autoZWrites(stage, [row.id])) ? undefined : 'seed');

		if (block) {
			blocks.set(row.id, block);
		}
	}

	return blocks;
}
