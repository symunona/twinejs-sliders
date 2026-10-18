/**
 * Using art from a pack the story has not attached attaches that pack.
 *
 * The library manager's checkboxes are the binding's `collections`. A scene that names an
 * asset living only in an unattached collection resolves to nothing, so the author would
 * have to go and tick the pack by hand. Instead, whatever path wrote the name -- the empty
 * scene's default `bg:`, a drag from the asset manager, autocomplete, typing -- the story
 * ends up bound to the collection that holds it.
 *
 * Conservative on purpose, because an attach is a sticky edit to the story:
 * - a name the story's view already resolves attaches nothing;
 * - `coll/name` attaches `coll`, whatever its kind (the author named it);
 * - a plain name attaches only a SHARED collection, and only when exactly one unattached
 *   shared collection has it. Two packs with a `forest` is the author's call, not ours.
 */

import type {LibraryEngine} from '@sliders/asset-library';
import {poseAssets} from '@sliders/scene-types';
import {placeholderCollectionName} from './story-asset-store';

/** Collection ids to attach so that `names` resolve. Attach order = first use order. */
export function collectionsToAttach(
	engine: LibraryEngine,
	storyId: string,
	names: Iterable<string>
): string[] {
	const resolver = engine.resolver(storyId);
	const inView = new Set(resolver.order().map(collection => collection.id));
	const live = engine.collections().filter(collection => !collection.deleted);
	const holders = new Map<string, Set<string>>();

	for (const record of [...engine.assets(), ...engine.characters()]) {
		if (record.deleted || inView.has(record.collection)) {
			continue;
		}

		const name = record.type === 'asset' ? record.name : record.charId;
		let set = holders.get(name);

		if (!set) {
			set = new Set();
			holders.set(name, set);
		}

		set.add(record.collection);
	}

	const shared = new Set(
		live.filter(collection => collection.kind === 'shared').map(c => c.id)
	);
	const attach: string[] = [];

	for (const name of names) {
		const resolution = resolver.resolve(name);

		if (resolution && !resolution.qualified) {
			continue;
		}

		if (resolution?.qualified) {
			const id = resolution.hit.collection.id;

			if (!inView.has(id) && !attach.includes(id)) {
				attach.push(id);
			}

			continue;
		}

		const candidates = [...(holders.get(name) ?? [])].filter(id =>
			shared.has(id)
		);

		if (candidates.length === 1 && !attach.includes(candidates[0])) {
			attach.push(candidates[0]);
		}
	}

	return attach;
}

/**
 * Append `ids` to the story's attached collections, creating its own collection and
 * binding first if it has none (named `storyName`, as the facade would). Returns the ids
 * actually added.
 */
export function attachCollections(
	engine: LibraryEngine,
	storyId: string,
	ids: string[],
	storyName?: string
): string[] {
	const attached = engine.binding(storyId)?.collections ?? [];
	const own = engine.binding(storyId)?.own;
	const fresh = ids.filter(id => id !== own && !attached.includes(id));

	if (fresh.length === 0) {
		return [];
	}

	const binding =
		engine.binding(storyId) ??
		engine.createStory(storyId, {
			name: storyName?.trim() || placeholderCollectionName(storyId)
		});

	engine.bind(storyId, [...(binding.collections ?? []), ...fresh]);

	return fresh;
}

/** Both steps: attach whatever `names` need. Returns the ids added. */
export function attachForNames(
	engine: LibraryEngine,
	storyId: string,
	names: Iterable<string>,
	storyName?: string
): string[] {
	return attachCollections(
		engine,
		storyId,
		collectionsToAttach(engine, storyId, names),
		storyName
	);
}

/** What a typed name is looked for as, in order. */
export type TypedNameKind = 'bg' | 'object' | 'character';

/** Search order per slot: the slot's own kind, then the other two. */
export const TYPED_NAME_ORDER: Record<TypedNameKind, TypedNameKind[]> = {
	bg: ['bg', 'object', 'character'],
	character: ['character', 'object', 'bg'],
	object: ['object', 'bg', 'character']
};

/**
 * The collection to attach for one name the author typed by hand into a `kind` slot.
 *
 * Unlike `collectionsToAttach`, this one picks: the author has just finished writing the
 * name, so a miss is worse than a guess. Already resolving = nothing. `coll/name` = `coll`.
 * Otherwise the first unattached pack holding it, by `TYPED_NAME_ORDER[kind]`, packs in
 * library manager order (shared first, then by name).
 */
export function collectionForTypedName(
	engine: LibraryEngine,
	storyId: string,
	name: string,
	kind: TypedNameKind
): string | undefined {
	const resolver = engine.resolver(storyId);
	const resolution = resolver.resolve(name);
	const inView = new Set(resolver.order().map(collection => collection.id));

	if (resolution) {
		const id = resolution.hit.collection.id;

		return resolution.qualified && !inView.has(id) ? id : undefined;
	}

	const packs = engine
		.collections()
		.filter(collection => !collection.deleted && !inView.has(collection.id))
		.sort(
			(a, b) =>
				Number(b.kind === 'shared') - Number(a.kind === 'shared') ||
				a.name.localeCompare(b.name)
		);
	const poseImages = new Set<string>();

	for (const character of engine.characters()) {
		for (const pose of Object.values(character.poses ?? {})) {
			poseAssets(pose).forEach(id => poseImages.add(id));
		}
	}

	const holds = (collection: string, want: TypedNameKind): boolean =>
		want === 'character'
			? engine
					.characters()
					.some(
						character =>
							!character.deleted &&
							character.collection === collection &&
							character.charId === name
					)
			: engine
					.assets(collection)
					.some(
						asset =>
							!asset.deleted &&
							asset.name === name &&
							asset.kind !== 'frame' &&
							typeof asset.ownerCharacter !== 'string' &&
							!poseImages.has(asset.id) &&
							(want === 'bg'
								? asset.kind === 'bg'
								: (asset.kind ?? 'object') === 'object' || asset.kind === 'fx')
					);

	for (const want of TYPED_NAME_ORDER[kind]) {
		const hit = packs.find(collection => holds(collection.id, want));

		if (hit) {
			return hit.id;
		}
	}

	return undefined;
}
