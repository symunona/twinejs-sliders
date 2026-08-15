/**
 * Turns the names a story writes into the assets and characters a bundle must carry.
 *
 * Nothing here throws. A half-written story is exactly the one most worth backing up, so
 * every miss becomes a line in `unresolved` and the export continues.
 */

import {AssetStore, entityKey} from '@sliders/asset-store';
import type {AssetMeta, Character} from '@sliders/scene-types';
import type {SceneAssetRefs} from './bundle.types';

export interface ResolvedBundleRefs {
	/** Deduped by id, ordered by id so a re-export produces the same zip. */
	assets: AssetMeta[];
	characters: Character[];
	/** Sorted, deduped. Means "found nothing" — never "found too much". */
	unresolved: string[];
	/**
	 * fx refs that matched more than one asset once mangled (see `fxIndex`). Not
	 * `unresolved`: something *was* found and does ride along, it just might be the wrong
	 * `fx/rain`. Kept separate so the pre-download report can say so without the manifest
	 * claiming the ref is missing.
	 */
	ambiguousFx: string[];
}

/**
 * Assets keyed by the slug `assetFragment` writes for them.
 *
 * `fx: [{id: rain}]` is what the editor emits for an asset named `fx/rain`, because
 * `entityKey()` keeps only the last path segment and slugifies it. That is lossy: both
 * `fx/rain` and `weather/rain` mangle to `rain`.
 *
 * Character frames are excluded. A frame is addressed through its character (`mira: {frame:
 * rain}`), never on its own, so a frame matching an `fx:` ref is a coincidence of slugs
 * rather than a reference — and bundling one on that basis ships an asset owned by a
 * character that is not in the bundle, which lands invisible in the library and unreachable
 * from the character editor.
 */
function fxIndex(assets: AssetMeta[]): Map<string, AssetMeta[]> {
	const index = new Map<string, AssetMeta[]>();

	for (const meta of assets) {
		if (meta.ownerCharacter) {
			continue;
		}

		const key = entityKey(meta.name);
		const bucket = index.get(key);

		if (bucket) {
			bucket.push(meta);
		} else {
			index.set(key, [meta]);
		}
	}

	return index;
}

export async function resolveBundleRefs(
	store: AssetStore,
	refs: SceneAssetRefs
): Promise<ResolvedBundleRefs> {
	// One pass over the library, not one per ref: a 40 MB library is thousands of metas
	// and every ref would re-read the manifest. Frames are included because a `bg:` may
	// legitimately name one.
	const all = [...(await store.list({includeFrames: true}))].sort((a, b) =>
		a.name.localeCompare(b.name)
	);
	const byName = new Map<string, AssetMeta>();

	for (const meta of all) {
		// LAST wins on a duplicate name, and the sort is by name alone. Both details exist
		// only to reproduce `createNamedResolver`, which builds its index as
		// `new Map(list.map(...))` — last write wins, ties left in list order. The store
		// does not enforce unique names (the asset editor only warns, 904386e8), so when
		// two assets share one, whichever the passage preview draws is the one that has to
		// end up in the bundle. Any other tie-break ships art the author never saw.
		byName.set(meta.name, meta);
	}

	const byFxKey = fxIndex(all);
	const assets = new Map<string, AssetMeta>();
	const characters = new Map<string, Character>();
	const unresolved = new Set<string>();
	const ambiguousFx = new Set<string>();

	/** Ids beat names, as everywhere else in the fork: `store.meta` first (spec 08). */
	async function byKey(ref: string): Promise<AssetMeta | undefined> {
		return (await store.meta(ref)) ?? byName.get(ref);
	}

	function take(meta: AssetMeta): void {
		assets.set(meta.id, meta);
	}

	for (const ref of refs.assetRefs) {
		const meta = await byKey(ref);

		if (meta) {
			take(meta);
		} else {
			unresolved.add(ref);
		}
	}

	for (const ref of refs.fxRefs) {
		const direct = await byKey(ref);

		if (direct) {
			take(direct);
			continue;
		}

		const mangled = byFxKey.get(ref) ?? [];
		// An fx-kind asset is the better answer for a ref that only exists in mangled
		// form because of the fx fragment; otherwise take the first by name sort.
		const preferred = mangled.filter(meta => meta.kind === 'fx');
		const candidates = preferred.length > 0 ? preferred : mangled;

		if (candidates.length === 0) {
			unresolved.add(ref);
			continue;
		}

		if (candidates.length > 1) {
			ambiguousFx.add(ref);
		}

		take(candidates[0]);
	}

	/**
	 * Pulls in a character and all of its frames — every frame, not just the ones the
	 * scenes name. Frames are small, and a character arriving with three of its nine frames
	 * makes the character editor useless on the other side (spec 08).
	 */
	async function takeCharacter(character: Character): Promise<void> {
		if (characters.has(character.id)) {
			return;
		}

		characters.set(character.id, character);

		for (const frame of Object.values(character.frames)) {
			const meta = await store.meta(frame.asset);

			if (meta) {
				take(meta);
			} else {
				// A frame pointing at an asset the library lost. Reported rather than
				// dropped, because the character will arrive with a dead frame.
				unresolved.add(frame.asset);
			}
		}
	}

	// Characters resolve by id only. `store.character` is id-keyed and so is
	// `createNamedResolver.character`, which is what actually draws the scene — a character
	// found here by name is one no scene in the bundle can address, and reporting it as
	// resolved would tell the author their story is fine when it renders nothing.
	for (const ref of refs.characterRefs) {
		const character = await store.character(ref);

		if (!character) {
			unresolved.add(ref);
			continue;
		}

		await takeCharacter(character);
	}

	// A frame that got picked up on its own — a `bg:` naming one, say — drags its character
	// along. Without this it arrives owned by a character that is not in the bundle, which
	// leaves it filtered out of the asset grid and unreachable from the character editor:
	// bytes the author can see the effects of but can never open or delete.
	for (const meta of [...assets.values()]) {
		if (!meta.ownerCharacter || characters.has(meta.ownerCharacter)) {
			continue;
		}

		const owner = await store.character(meta.ownerCharacter);

		if (owner) {
			await takeCharacter(owner);
		}
	}

	// Frames a scene names that its character does not have. Only checkable when the
	// entity id is the character id — which is the default, since `ref` falls back to the
	// entity key — so anything else is left alone rather than guessed at.
	for (const [entityId, frames] of Object.entries(refs.frameRefs)) {
		const character = characters.get(entityId);

		if (!character) {
			continue;
		}

		for (const frame of frames) {
			if (!character.frames[frame]) {
				unresolved.add(`${entityId}/${frame}`);
			}
		}
	}

	return {
		ambiguousFx: [...ambiguousFx].sort(),
		assets: [...assets.values()].sort((a, b) => a.id.localeCompare(b.id)),
		characters: [...characters.values()].sort((a, b) =>
			a.id.localeCompare(b.id)
		),
		unresolved: [...unresolved].sort()
	};
}
