import {AssetRecord, LibraryEngine} from '@sliders/asset-library';

/**
 * What scene autocomplete offers beyond the story's resolved names (plan 1, "Scene
 * editor autocomplete"):
 *
 * - `coll/name` for a name two collections in the story's order both hold — the
 *   shadowed or ambiguous one is only reachable qualified.
 * - Names from team collections the story does not attach, at the bottom. Picking one
 *   attaches its collection.
 */
export interface LibraryHint {
	/** What lands in the scene. */
	insert: string;
	/** What the dropdown shows. */
	label: string;
	kind: string;
	/** `qualified` = shadowed/ambiguous; `team` = unattached collection. */
	source: 'qualified' | 'team';
	/** Team only: the collection a pick attaches. */
	collection?: string;
}

export interface LibraryHintExtras {
	hints: LibraryHint[];
	attach: (collection: string) => void;
}

/** Team names offered at most, so a huge library cannot drown the dropdown. */
export const TEAM_HINT_LIMIT = 200;

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
	const inView = new Set(order.map(collection => collection.id));
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
				label: `${collection}/${name}`,
				source: 'qualified'
			});
		}
	}

	const visibleNames = new Set(holders.keys());
	const team = engine
		.collections()
		.filter(collection => !inView.has(collection.id))
		.sort((a, b) => a.name.localeCompare(b.name));

	for (const collection of team) {
		for (const asset of engine.assets(collection.id).filter(named)) {
			if (hints.length >= TEAM_HINT_LIMIT) {
				return hints;
			}

			// A name the story already answers stays pinned to its owner: qualified.
			const insert = visibleNames.has(asset.name)
				? `${collection.name}/${asset.name}`
				: asset.name;

			hints.push({
				collection: collection.id,
				insert,
				kind: asset.kind ?? 'object',
				label: `${asset.name} — ${collection.name}`,
				source: 'team'
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
		.sort(
			(a, b) =>
				(a.source === b.source ? 0 : a.source === 'qualified' ? -1 : 1) ||
				a.label.localeCompare(b.label)
		);
}
