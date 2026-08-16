/**
 * `of:` — relative placement (D17).
 *
 * An entity with `of: <id>` writes its `at` as an offset from that entity instead of as an
 * absolute stage coordinate. Move the parent and the child comes along.
 *
 *   props:
 *     table:  {at: -0.3}
 *     candle: {of: table, at: [0.1, 0.2], layer: front}
 *
 * Translation only. The parent's `scale`, `flip` and `frame` do NOT reach the child, which
 * is the whole reason this can live here: resolution is a vector add, needs no sprite
 * metrics, no asset resolver and no stage box, and so it can run in `scene-core` where the
 * DIFFER can see it. That matters more than it looks — see below.
 *
 * WHERE TO CALL IT
 *
 * At the draw and diff boundary, and nowhere else:
 *
 *   applyScene / runBeats  ->  stages in AUTHORED space (at is local, `of` intact)
 *   resolveStage()         ->  stages in ABSOLUTE space (at is world, `of` stripped)
 *   diffStages / render    ->  absolute only
 *
 * Never before `from:` inheritance or a beat patch. Those shallow-merge the author's own
 * numbers (`mira: {at: 0.1}`), and merging a local number onto an already-resolved absolute
 * one is exactly how a child ends up double-offset. `scene-index` therefore stores
 * UNRESOLVED states, because that is what a patch scene inherits.
 *
 * WHY THE DIFFER NEEDS ABSOLUTE
 *
 * `diffStages` compares placements to decide what animates. If it saw local coordinates, a
 * parent moving would leave every child's `at` untouched — no `move` transition emitted —
 * and the children would teleport while the parent glided. Diffing resolved stages makes
 * that case correct with no knowledge of the graph in the differ at all.
 *
 * IDEMPOTENCE
 *
 * `resolveStage` strips `of`, so resolving twice is a no-op rather than a silent double
 * offset. It is the only protection against a caller further down the pipeline resolving
 * again "just in case", and it is why the parent lookup the editor needs is exposed as
 * `parentOffsets` instead of by leaving `of` on the resolved entity.
 */

import type {EntityId, Stage, StageEntity, Vec2} from '@sliders/scene-types';

/**
 * Chain length before a stage is treated as malformed. Far past any real scene; this exists
 * so a graph that somehow escaped cycle-breaking still terminates.
 */
const MAX_DEPTH = 64;

const ORIGIN: Vec2 = {x: 0, y: 0};

function at(entity: StageEntity | undefined): Vec2 {
	const value = entity?.at;

	return {
		x: Number.isFinite(value?.x) ? (value as Vec2).x : 0,
		y: Number.isFinite(value?.y) ? (value as Vec2).y : 0
	};
}

/**
 * Every entity's parent, with the edges that cannot be honoured removed:
 *
 *   - a parent that is not on stage (typo, or removed by a patch that left its child behind)
 *   - an entity naming itself
 *   - any edge that would close a cycle
 *
 * A dropped edge means the entity falls back to world space at its own `at`. That is the
 * only non-destructive answer: dropping the entity would make a typo delete art, and
 * recursing would hang. The parser reports both cases where it can see them; a stage built
 * by hand, or assembled across `from:`, gets this net instead.
 *
 * Ids are walked in sorted order so which edge of a cycle gets cut does not depend on the
 * insertion order of a `Record` — the same stage always resolves the same way, which is the
 * rule the rest of `scene-core` already follows.
 */
function effectiveParents(
	entities: Record<EntityId, StageEntity>
): Map<EntityId, EntityId | undefined> {
	const ids = Object.keys(entities).sort();
	const parents = new Map<EntityId, EntityId | undefined>();

	for (const id of ids) {
		const parent = entities[id]?.of;

		parents.set(
			id,
			typeof parent === 'string' && parent !== id && entities[parent]
				? parent
				: undefined
		);
	}

	for (const id of ids) {
		const seen = new Set<EntityId>([id]);
		let cursor = parents.get(id);
		let depth = 0;

		while (cursor !== undefined) {
			if (seen.has(cursor) || ++depth > MAX_DEPTH) {
				// `id` is its own ancestor. Cut the edge HERE, at the entity the walk started
				// from, rather than wherever the repeat was noticed: sorted order then makes
				// the cut deterministic, and every other member of the cycle keeps its edge
				// and simply hangs off the one that was freed.
				parents.set(id, undefined);
				break;
			}

			seen.add(cursor);
			cursor = parents.get(cursor);
		}
	}

	return parents;
}

/**
 * Absolute position per entity id, `of` chains followed.
 *
 * Exported for the editor, which needs to know where an entity's local origin is in order to
 * turn a drag — which happens in absolute space, because that is where the pointer is — back
 * into the offset that gets written to the YAML.
 */
export function worldPositions(stage: Stage): Record<EntityId, Vec2> {
	const entities = stage?.entities ?? {};
	const parents = effectiveParents(entities);
	const world: Record<EntityId, Vec2> = {};

	// Memoized rather than sorted topologically: the parent chain is already known to be
	// acyclic, so recursion terminates, and every id is resolved at most once.
	const resolve = (id: EntityId): Vec2 => {
		const cached = world[id];

		if (cached) {
			return cached;
		}

		const local = at(entities[id]);
		const parent = parents.get(id);

		const offset = parent === undefined ? ORIGIN : resolve(parent);
		const out = {x: local.x + offset.x, y: local.y + offset.y};

		world[id] = out;
		return out;
	};

	for (const id of Object.keys(entities)) {
		resolve(id);
	}

	return world;
}

/**
 * Where each child's local `at` is measured FROM, in absolute coordinates.
 *
 * Only entities with a parent that was actually honoured appear. An id that is absent is in
 * world space, so a caller reads it as the origin.
 */
export function parentOffsets(stage: Stage): Record<EntityId, Vec2> {
	const entities = stage?.entities ?? {};
	const parents = effectiveParents(entities);
	const world = worldPositions(stage);
	const offsets: Record<EntityId, Vec2> = {};

	for (const id of Object.keys(entities)) {
		const parent = parents.get(id);

		if (parent !== undefined) {
			offsets[id] = {...(world[parent] ?? ORIGIN)};
		}
	}

	return offsets;
}

/**
 * The same stage in absolute coordinates. `of` is consumed and stripped, so this is
 * idempotent and a renderer or differ downstream cannot apply the offset twice.
 *
 * A stage with no `of` anywhere is returned unchanged, by identity — the overwhelmingly
 * common case, and the preview re-derives this on every keystroke.
 */
export function resolveStage(stage: Stage): Stage {
	const entities = stage?.entities ?? {};
	const ids = Object.keys(entities);

	if (!ids.some(id => entities[id]?.of !== undefined)) {
		return stage;
	}

	const world = worldPositions(stage);
	const resolved: Record<EntityId, StageEntity> = {};

	for (const id of ids) {
		resolved[id] = {
			...entities[id],
			at: {...(world[id] ?? ORIGIN)},
			of: undefined
		};
	}

	return {...stage, entities: resolved};
}
