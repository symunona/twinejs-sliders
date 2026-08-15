import type {
	AssetId,
	AssetKind,
	AssetMeta,
	AssetResolver,
	Character
} from '@sliders/scene-types';

/** Which persistence layer ended up being used. Surfaced in the UI for support reasons. */
export type BackendKind = 'opfs' | 'indexeddb' | 'electron';

export interface AssetFilter {
	kind?: AssetKind;
	/** Case-insensitive substring match against the asset name. */
	search?: string;
	/** Asset must carry every tag listed. */
	tags?: string[];
	/**
	 * Character frames are hidden by default (spec 03) — they belong to the character
	 * editor, not the flat library list.
	 */
	includeFrames?: boolean;
}

export interface PutAssetOptions {
	kind?: AssetKind;
	/** Defaults to a slug derived from the filename. */
	name?: string;
	tags?: string[];
	/** Set when the asset is a character frame. */
	ownerCharacter?: string;
	/** Set when the asset is an edited copy of another one. */
	sourceAsset?: AssetId;
}

export interface PutAssetResult {
	id: AssetId;
	meta: AssetMeta;
	/**
	 * True when a file with this content hash was already in the library. The existing
	 * asset is returned rather than a second copy being made — the UI warns instead of
	 * silently duplicating (spec 03).
	 */
	duplicate: boolean;
	/** Set when the upload was re-encoded to WebP. */
	transcoded: boolean;
}

/**
 * The asset library. Deliberately separate from story text: story text rides undo,
 * archive, and import/export, and 40 MB of sprites must not ride along (spec 03).
 */
export interface AssetStore extends AssetResolver {
	readonly backend: BackendKind;
	put(file: File, options?: PutAssetOptions): Promise<AssetId>;
	/** Same upload, with the duplicate/transcode report the UI needs. */
	putAsset(file: File, options?: PutAssetOptions): Promise<PutAssetResult>;
	get(id: AssetId): Promise<Blob | undefined>;
	url(id: AssetId): Promise<string | undefined>;
	meta(id: AssetId): Promise<AssetMeta | undefined>;
	list(filter?: AssetFilter): Promise<AssetMeta[]>;
	update(id: AssetId, changes: Partial<AssetMeta>): Promise<AssetMeta>;
	remove(id: AssetId): Promise<void>;
	putCharacter(character: Character): Promise<Character>;
	character(id: string): Promise<Character | undefined>;
	getCharacter(id: string): Promise<Character | undefined>;
	listCharacters(): Promise<Character[]>;
	removeCharacter(id: string): Promise<void>;
}

/** What the store persists. Manifest is text; blobs are stored one per asset id. */
export interface AssetManifest {
	version: 1;
	assets: Record<AssetId, AssetMeta>;
	characters: Record<string, Character>;
}

export function emptyManifest(): AssetManifest {
	return {version: 1, assets: {}, characters: {}};
}

/**
 * The narrow thing each platform has to implement. Everything interesting — sniffing,
 * transcoding, hashing, ids — lives above this line so it is written once.
 */
export interface StorageBackend {
	readonly kind: BackendKind;
	readManifest(): Promise<AssetManifest>;
	writeManifest(manifest: AssetManifest): Promise<void>;
	readBlob(id: AssetId): Promise<Blob | undefined>;
	writeBlob(id: AssetId, blob: Blob): Promise<void>;
	deleteBlob(id: AssetId): Promise<void>;
}
