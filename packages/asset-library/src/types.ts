import type {
	AssetEffect,
	AssetKind,
	AssetMask,
	CharacterPose,
	CutoutTuning,
	Frac2,
	ImageEdits,
	WalkArea
} from '@sliders/scene-types';

/**
 * The shared asset library's record types (docs/sliders/plans/asset-library-contract.md).
 *
 * Every record syncs whole. The server validates a handful of fields per type and stores
 * the rest verbatim, which is why every interface here ends in an index signature: a field
 * this client does not know yet still round-trips, instead of being dropped by a type.
 */
export type RecordType = 'collection' | 'asset' | 'character' | 'binding';

export const RECORD_TYPES: readonly RecordType[] = [
	'collection',
	'asset',
	'character',
	'binding'
];

/** URL segment per type: `/api/v1/lib/assets/<id>`. */
export const TYPE_PATHS: Readonly<Record<RecordType, string>> = {
	collection: 'collections',
	asset: 'assets',
	character: 'characters',
	binding: 'bindings'
};

/** Fields the server owns. Whatever a client sends in them is ignored. */
export const SERVER_FIELDS = ['rev', 'by', 'at'] as const;

/** Fields that say which record this is, not what it holds. Never merged. */
export const ENVELOPE_FIELDS = ['id', 'type', 'rev', 'by', 'at'] as const;

export interface RecordEnvelope {
	/** uuid v4. A binding's id is its story's id instead. */
	id: string;
	type: RecordType;
	/** Server-assigned. 0 on a record the server has never seen. */
	rev: number;
	deleted: boolean;
	/** Server-assigned: the X-Client-Name that wrote this rev. */
	by: string;
	/** Server-assigned, `2026-09-28T14:02:11Z`. */
	at: string;
	[field: string]: unknown;
}

export type CollectionKind = 'story' | 'shared';

export interface CollectionRecord extends RecordEnvelope {
	type: 'collection';
	/** Unique team-wide among non-deleted collections. */
	name: string;
	kind: CollectionKind;
	description?: string;
	/** Curated: repaints ask to fork. Client-side rule only; the server ignores it. */
	locked?: boolean;
}

/**
 * How an asset's bytes were made, keyed so a merge can take one key from each side.
 * Open: a key added later travels without this type knowing it.
 */
export interface AssetRecipe {
	edits?: ImageEdits;
	tuning?: CutoutTuning;
	mask?: AssetMask;
	effect?: AssetEffect;
	walk?: WalkArea;
	origin?: Frac2;
	[key: string]: unknown;
}

export interface AssetRecord extends RecordEnvelope {
	type: 'asset';
	collection: string;
	/** Unique in its collection, shared namespace with character `charId`s. */
	name: string;
	/** sha256 hex of the current bytes. */
	blob: string;
	/** Extra blobs by kind (`src`, `cutout`), each a sha. */
	sidecars?: Record<string, string>;
	kind?: AssetKind;
	tags?: string[];
	mime?: string;
	w?: number;
	h?: number;
	bytes?: number;
	/** sha256 of the decoded pixels: same picture, any encoding. */
	pixelHash?: string;
	/** 64-bit dHash, 16 hex chars. */
	phash?: string;
	recipe?: AssetRecipe;
	/** Set on a copy or a fork: the asset it came from. */
	sourceAsset?: string;
	animated?: boolean;
	duration?: number;
}

export interface CharacterRecord extends RecordEnvelope {
	type: 'character';
	collection: string;
	/** The name scene YAML uses. Unique in the collection, shared with asset names. */
	charId: string;
	name?: string;
	/** Pose images are asset uuids, not names. */
	poses?: Record<string, CharacterPose>;
	tags?: string[];
}

export interface BindingRecord extends RecordEnvelope {
	type: 'binding';
	/** The story's own collection. Always first in resolution order. */
	own: string;
	/** Attached collections, in resolution order. `own` is not repeated here. */
	collections?: string[];
	/** Asset ids the story's scenes use. Feeds `usage()`. */
	refs?: string[];
}

export type LibRecord =
	| CollectionRecord
	| AssetRecord
	| CharacterRecord
	| BindingRecord;

export type RecordOf<T extends RecordType> = Extract<LibRecord, {type: T}>;

/** Wire shapes. */

export interface ChangeItem {
	seq: number;
	record: LibRecord;
}

export interface ChangesPage {
	seq: number;
	items: ChangeItem[];
	more: boolean;
}

export interface WriteResult {
	record: LibRecord;
	seq: number;
}

export interface BlobInfo {
	sha: string;
	bytes: number;
	mime: string;
}

export interface RevEntry {
	rev: number;
	by: string;
	at: string;
	record: LibRecord;
}

/** Socket message. Advisory only: the client always reads `/changes`. */
export interface LibSocketMessage {
	t: 'lib';
	seq: number;
	type: RecordType;
	id: string;
	rev: number;
	by: string;
}

/** Key a record by type as well as id: a binding's id is a story id, not a uuid. */
export function recordKey(type: RecordType, id: string): string {
	return `${type}/${id}`;
}

export function parseRecordKey(key: string): {type: RecordType; id: string} {
	const slash = key.indexOf('/');

	return {
		type: key.slice(0, slash) as RecordType,
		id: key.slice(slash + 1)
	};
}

/** The collection(s) a record lives in or points at, for scoping change events. */
export function recordCollections(record: LibRecord | undefined): string[] {
	if (!record) {
		return [];
	}

	switch (record.type) {
		case 'collection':
			return [record.id];
		case 'asset':
		case 'character':
			return [record.collection];
		case 'binding':
			return [record.own, ...(record.collections ?? [])];
	}
}

/** The sha256s an asset record names: `blob` and every sidecar. */
export function recordBlobs(record: LibRecord | undefined): string[] {
	if (!record || record.type !== 'asset') {
		return [];
	}

	const shas = [record.blob, ...Object.values(record.sidecars ?? {})];

	return Array.from(new Set(shas.filter(Boolean)));
}

/** The name a record occupies in its collection's namespace, if any. */
export function namespaceName(record: LibRecord): string | undefined {
	if (record.type === 'asset') {
		return record.name;
	}

	if (record.type === 'character') {
		return record.charId;
	}

	return undefined;
}
