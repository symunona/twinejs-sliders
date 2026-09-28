import {
	AssetRecord,
	BindingRecord,
	CollectionRecord,
	LibraryEngine,
	LibRecord,
	recordCollections,
	RecordType,
	SIMILAR_DISTANCE,
	StatusEvent,
	hamming
} from '@sliders/asset-library';

/**
 * Pure reads over the engine for the Library dialog (asset-library-1-architecture.md,
 * "Library UI"). No React: every function takes the engine and answers now.
 */

/** Rail selection: a collection id, the story's own (`mine`), or everything. */
export type RailSelection = string;
export const MINE = 'mine';
export const ALL = 'all';

/** Data type a tile drag carries so a rail item can take it (move, Alt = copy). */
export const LIBRARY_ASSET_MIME = 'application/x-sliders-library-asset';

export interface LibrarySnapshot {
	binding?: BindingRecord;
	/** The story's own collection. Undefined until the story writes anything. */
	own?: CollectionRecord;
	/** Attached, in resolution order. */
	attached: CollectionRecord[];
	/** Every other live collection, other stories' own ones included. */
	team: CollectionRecord[];
	/** own + attached ids: what the story's names resolve through. */
	viewIds: string[];
}

export function librarySnapshot(
	engine: LibraryEngine | undefined,
	storyId: string
): LibrarySnapshot {
	if (!engine) {
		return {attached: [], team: [], viewIds: []};
	}

	const collections = engine.collections();
	const byId = new Map(collections.map(collection => [collection.id, collection]));
	const binding = engine.binding(storyId);
	const own = binding ? byId.get(binding.own) : undefined;
	const attached = (binding?.collections ?? [])
		.map(id => byId.get(id))
		.filter((collection): collection is CollectionRecord => !!collection);
	const taken = new Set([own?.id, ...attached.map(collection => collection.id)]);
	const team = collections
		.filter(collection => !taken.has(collection.id))
		.sort((a, b) => a.name.localeCompare(b.name));

	return {
		attached,
		binding,
		own,
		team,
		viewIds: [own?.id, ...attached.map(collection => collection.id)].filter(
			(id): id is string => !!id
		)
	};
}

/** The collection id a rail selection stands for. `all` and a fresh Mine have none. */
export function selectedCollection(
	snapshot: LibrarySnapshot,
	selection: RailSelection
): string | undefined {
	if (selection === ALL) {
		return undefined;
	}

	if (selection === MINE) {
		return snapshot.own?.id;
	}

	return selection;
}

export interface CollectionSync {
	pending: number;
	conflicts: number;
	downloading: number;
	offline: boolean;
}

/** Records of one collection (itself included), tombstones too: pending deletes count. */
function collectionRecords(
	engine: LibraryEngine,
	collection: string
): LibRecord[] {
	return [
		...engine
			.list('collection', {includeDeleted: true})
			.filter(record => record.id === collection),
		...engine
			.list('asset', {includeDeleted: true})
			.filter(record => record.collection === collection),
		...engine
			.list('character', {includeDeleted: true})
			.filter(record => record.collection === collection)
	];
}

/**
 * One collection's chip. `collection` undefined = the whole library (the story list's
 * aggregate chip, and All assets).
 */
export function collectionSync(
	engine: LibraryEngine,
	collection: string | undefined,
	status: StatusEvent & {online?: boolean}
): CollectionSync {
	const offline = status.offline || status.online === false;

	if (!collection) {
		return {
			conflicts: status.conflicts,
			downloading: status.downloading ?? 0,
			offline,
			pending: status.pending
		};
	}

	let pending = 0;
	let conflicts = 0;
	const blobs = new Set<string>();

	for (const record of collectionRecords(engine, collection)) {
		const state = engine.state(record.id, record.type);

		if (state?.conflict) {
			conflicts++;
		} else if (state?.dirty) {
			pending++;
		}

		if (record.type === 'asset' && !record.deleted) {
			blobs.add(record.blob);
		}
	}

	// A conflict whose local copy moved away still belongs where it came from.
	for (const conflict of engine.conflicts()) {
		if (
			!recordCollections(conflict.local).includes(collection) &&
			recordCollections(conflict.current ?? undefined).includes(collection)
		) {
			conflicts++;
		}
	}

	return {
		conflicts,
		downloading: engine.downloading().filter(sha => blobs.has(sha)).length,
		offline,
		pending
	};
}

export type RecordSync = 'conflict' | 'pending' | 'downloading' | undefined;

export function recordSync(
	engine: LibraryEngine,
	id: string,
	type: RecordType
): RecordSync {
	const state = engine.state(id, type);

	if (state?.conflict) {
		return 'conflict';
	}

	if (state?.dirty) {
		return 'pending';
	}

	if (
		type === 'asset' &&
		state &&
		engine.downloading().includes((state.local as AssetRecord).blob)
	) {
		return 'downloading';
	}

	return undefined;
}

/**
 * Names the story's scenes use that only `collection` answers: detaching it leaves them
 * asking for nothing. Resolution order minus that collection.
 */
export function namesOnlyIn(
	engine: LibraryEngine,
	snapshot: LibrarySnapshot,
	collection: string,
	usedNames: Iterable<string>
): string[] {
	const others = snapshot.viewIds.filter(id => id !== collection);
	const held = (id: string) =>
		new Set([
			...engine.assets(id).map(asset => asset.name),
			...engine.characters(id).map(character => character.charId)
		]);
	const here = held(collection);
	const elsewhere = new Set(others.flatMap(id => [...held(id)]));

	return Array.from(new Set(usedNames))
		.filter(name => here.has(name) && !elsewhere.has(name))
		.sort();
}

/** Reorders `ids` so `moving` sits where `target` was. */
export function reorder(ids: string[], moving: string, target: string): string[] {
	if (moving === target) {
		return ids;
	}

	const without = ids.filter(id => id !== moving);
	const at = without.indexOf(target);
	const from = ids.indexOf(moving);
	const to = ids.indexOf(target);

	without.splice(from < to ? at + 1 : at, 0, moving);

	return without;
}

export type DupeTier = 'exact' | 'pixel' | 'similar';

export interface DupeGroup {
	tier: DupeTier;
	/** Stable key: tier + sorted ids. */
	key: string;
	assets: AssetRecord[];
}

/**
 * Duplicates across the whole library, three tiers (plan 1, "Dedup"):
 * - exact: same blob sha
 * - pixel: same decoded pixels, different bytes
 * - similar: dHash within SIMILAR_DISTANCE, not already pixel-equal
 * Pose images are left out: they have no public name to merge.
 */
export function duplicateGroups(
	assets: AssetRecord[],
	isPoseImage: (asset: AssetRecord) => boolean = () => false
): DupeGroup[] {
	const candidates = assets.filter(
		asset => !asset.deleted && !isPoseImage(asset) && asset.kind !== 'sound'
	);
	const groups: DupeGroup[] = [];
	const push = (tier: DupeTier, members: AssetRecord[]) => {
		const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name));

		groups.push({
			assets: sorted,
			key: `${tier}:${sorted
				.map(asset => asset.id)
				.sort()
				.join(',')}`,
			tier
		});
	};
	const bucket = (key: (asset: AssetRecord) => string | undefined) => {
		const out = new Map<string, AssetRecord[]>();

		for (const asset of candidates) {
			const value = key(asset);

			if (value) {
				out.set(value, [...(out.get(value) ?? []), asset]);
			}
		}

		return out;
	};

	for (const members of bucket(asset => asset.blob).values()) {
		if (members.length > 1) {
			push('exact', members);
		}
	}

	for (const members of bucket(asset => asset.pixelHash).values()) {
		// One per blob: same-blob pairs are already an exact group.
		const distinct = Array.from(
			new Map(members.map(asset => [asset.blob, asset])).values()
		);

		if (distinct.length > 1) {
			push('pixel', distinct);
		}
	}

	// Similar: union-find over dHash pairs whose pixels differ.
	const hashed = candidates.filter(asset => asset.phash);
	const parent = new Map(hashed.map(asset => [asset.id, asset.id]));
	const find = (id: string): string => {
		const up = parent.get(id)!;

		return up === id ? id : find(up);
	};

	for (let i = 0; i < hashed.length; i++) {
		for (let j = i + 1; j < hashed.length; j++) {
			const a = hashed[i];
			const b = hashed[j];

			if (
				a.blob === b.blob ||
				(a.pixelHash && a.pixelHash === b.pixelHash) ||
				a.phash!.length !== b.phash!.length ||
				hamming(a.phash!, b.phash!) > SIMILAR_DISTANCE
			) {
				continue;
			}

			parent.set(find(a.id), find(b.id));
		}
	}

	const clusters = new Map<string, AssetRecord[]>();

	for (const asset of hashed) {
		const root = find(asset.id);

		clusters.set(root, [...(clusters.get(root) ?? []), asset]);
	}

	for (const members of clusters.values()) {
		if (members.length > 1) {
			push('similar', members);
		}
	}

	return groups;
}

/** Collection name for display: `Story: Old Mill` for another story's own. */
export function collectionLabel(
	collection: CollectionRecord | undefined,
	storyLabel: (name: string) => string
): string {
	if (!collection) {
		return '';
	}

	return collection.kind === 'story'
		? storyLabel(collection.name)
		: collection.name;
}
