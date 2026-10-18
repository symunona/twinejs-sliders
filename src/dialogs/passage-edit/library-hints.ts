import {AssetRecord, LibraryEngine} from '@sliders/asset-library';

/**
 * What scene autocomplete offers beyond the story's resolved names (plan 1, "Scene
 * editor autocomplete"): `coll/name` for a name two collections in the story's order
 * both hold — the shadowed or ambiguous one is only reachable qualified.
 *
 * Attached packs only. Unattached packs are never offered: a typed name attaches its
 * pack instead (`collectionForTypedName`).
 */
export interface LibraryHint {
	/** What lands in the scene. */
	insert: string;
	/** What the dropdown shows. */
	label: string;
	kind: string;
}

export interface LibraryHintExtras {
	hints: LibraryHint[];
}

function named(asset: AssetRecord): boolean {
	return (
		!asset.deleted &&
		asset.kind !== 'frame' &&
		typeof asset.ownerCharacter !== 'string'
	);
}

export function libraryHints(
	engine: LibraryEngine,
	storyId: string
): LibraryHint[] {
	const resolver = engine.resolver(storyId);
	const order = resolver.order();
	const holders = new Map<string, {asset: AssetRecord; collection: string}[]>();

	for (const collection of order) {
		for (const asset of engine.assets(collection.id).filter(named)) {
			holders.set(asset.name, [
				...(holders.get(asset.name) ?? []),
				{asset, collection: collection.name}
			]);
		}
	}

	const hints: LibraryHint[] = [];

	for (const [name, list] of holders) {
		if (list.length < 2) {
			continue;
		}

		for (const {asset, collection} of list) {
			hints.push({
				insert: `${collection}/${name}`,
				kind: asset.kind ?? 'object',
				label: `${collection}/${name}`
			});
		}
	}

	return hints;
}

/** The extras a slot can take: backdrops for `bg:`, objects and fx for props. */
export function hintsForSlot(
	slot: string,
	hints: LibraryHint[]
): LibraryHint[] {
	const kinds =
		slot === 'bg'
			? ['bg']
			: slot === 'props' || slot === 'entities'
			? ['object', 'fx']
			: [];

	return hints
		.filter(hint => kinds.includes(hint.kind))
		.sort((a, b) => a.label.localeCompare(b.label));
}
