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
