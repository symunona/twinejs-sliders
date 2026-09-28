import {
	AssetRecord,
	BindingRecord,
	CharacterRecord,
	CollectionRecord
} from './types';

/**
 * Scene name → record, for one story (plan 1, "Name resolution").
 *
 * Order: the story's own collection, then its attached collections as listed. First hit
 * wins; the same name further down is shadowed. `coll/name` is qualified and skips the
 * order — any live collection, attached or not.
 */

export interface ResolveIndex {
	collections: CollectionRecord[];
	assets: AssetRecord[];
	characters: CharacterRecord[];
	binding?: BindingRecord;
}

export type Resolved =
	| {kind: 'asset'; record: AssetRecord; collection: CollectionRecord}
	| {kind: 'character'; record: CharacterRecord; collection: CollectionRecord};

export interface Resolution {
	hit: Resolved;
	/** Same name in collections later in the order. */
	shadowed: Resolved[];
	qualified: boolean;
}

export type LintCode = 'missing' | 'ambiguous' | 'shadowed';

export interface LintIssue {
	ref: string;
	code: LintCode;
	level: 'error' | 'warning' | 'info';
	/** Collection names involved, in resolution order. */
	collections: string[];
	/** For `ambiguous`: the qualified form that pins today's pick. */
	suggestion?: string;
}

export class Resolver {
	private byCollection = new Map<string, Map<string, Resolved>>();
	private collectionsById = new Map<string, CollectionRecord>();
	private collectionsByName = new Map<string, CollectionRecord>();
	private orderIds: string[];

	constructor(index: ResolveIndex) {
		for (const collection of index.collections) {
			if (collection.deleted) {
				continue;
			}

			this.collectionsById.set(collection.id, collection);
			this.collectionsByName.set(collection.name, collection);
			this.byCollection.set(collection.id, new Map());
		}

		for (const record of index.assets) {
			this.add(record.collection, record.name, record, 'asset');
		}

		for (const record of index.characters) {
			this.add(record.collection, record.charId, record, 'character');
		}

		const binding =
			index.binding && !index.binding.deleted ? index.binding : undefined;
		const order = binding ? [binding.own, ...(binding.collections ?? [])] : [];

		this.orderIds = Array.from(new Set(order)).filter(id =>
			this.collectionsById.has(id)
		);
	}

	private add(
		collectionId: string,
		name: string,
		record: AssetRecord | CharacterRecord,
		kind: 'asset' | 'character'
	) {
		const names = this.byCollection.get(collectionId);
		const collection = this.collectionsById.get(collectionId);

		if (!names || !collection || record.deleted) {
			return;
		}

		names.set(name, {kind, record, collection} as Resolved);
	}

	/** Resolution order, own collection first. Deleted or unknown collections are skipped. */
	order(): CollectionRecord[] {
		return this.orderIds.map(id => this.collectionsById.get(id)!);
	}

	private hits(name: string): Resolved[] {
		const hits: Resolved[] = [];

		for (const id of this.orderIds) {
			const hit = this.byCollection.get(id)!.get(name);

			if (hit) {
				hits.push(hit);
			}
		}

		return hits;
	}

	/** `coll/name` against every live collection, trying each `/` as the split. */
	private qualified(ref: string): Resolved | undefined {
		for (
			let slash = ref.indexOf('/');
			slash > 0;
			slash = ref.indexOf('/', slash + 1)
		) {
			const collection = this.collectionsByName.get(ref.slice(0, slash));
			const hit =
				collection &&
				this.byCollection.get(collection.id)!.get(ref.slice(slash + 1));

			if (hit) {
				return hit;
			}
		}

		return undefined;
	}

	resolve(ref: string): Resolution | undefined {
		const hits = this.hits(ref);

		// A plain name wins over a qualified reading: asset names may contain `/`.
		if (hits.length) {
			return {hit: hits[0], shadowed: hits.slice(1), qualified: false};
		}

		const qualified = this.qualified(ref);

		return qualified && {hit: qualified, shadowed: [], qualified: true};
	}

	asset(ref: string): AssetRecord | undefined {
		const hit = this.resolve(ref)?.hit;

		return hit?.kind === 'asset' ? hit.record : undefined;
	}

	character(charId: string): CharacterRecord | undefined {
		const hit = this.resolve(charId)?.hit;

		return hit?.kind === 'character' ? hit.record : undefined;
	}

	lint(refs: Iterable<string>): LintIssue[] {
		const issues: LintIssue[] = [];
		const own = this.orderIds[0];

		for (const ref of new Set(refs)) {
			const hits = this.hits(ref);

			if (!hits.length) {
				if (!this.qualified(ref)) {
					issues.push({ref, code: 'missing', level: 'error', collections: []});
				}

				continue;
			}

			if (hits.length < 2) {
				continue;
			}

			const names = hits.map(hit => hit.collection.name);

			if (hits[0].collection.id === own) {
				// A story copy shadowing shared art: how a fork works. Informational.
				issues.push({ref, code: 'shadowed', level: 'info', collections: names});
			} else {
				issues.push({
					ref,
					code: 'ambiguous',
					level: 'warning',
					collections: names,
					suggestion: `${hits[0].collection.name}/${ref}`
				});
			}
		}

		return issues;
	}
}
