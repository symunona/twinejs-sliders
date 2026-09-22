import type {
	AssetId,
	AssetKind,
	AssetMeta,
	AssetResolver,
	Character,
	CutoutTuning,
	Frac2,
	ImageEdits,
	SidecarKind
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
	/** Where the art is pinned, as a fraction. Defaults to bottom centre when absent. */
	origin?: Frac2;
	/** What the asset editor baked these bytes with, so the edit can be re-opened. */
	edits?: ImageEdits;
	/** What the cutout controls were set to. Only meaningful with a `cutout` sidecar. */
	tuning?: CutoutTuning;
	/**
	 * Extra blobs to keep beside the bytes, by kind — `src` for the pixels the edit
	 * started from, `cutout` for the alpha map a background removal produced.
	 *
	 * Open on purpose: a feature that needs its own blob names a new kind and nothing
	 * here changes. The kind becomes the blob's key suffix (`a_8f21.cutout`), so it has
	 * to be a slug; `sidecarKey` says so out loud.
	 */
	sidecars?: Partial<Record<SidecarKind, Blob | null>>;
}

/**
 * What an edit wants remembered alongside the bytes it just baked.
 *
 * All of it is optional and all of it is additive: a `replace` that passes none of this
 * behaves exactly as it always did, which is what keeps the bundle importer and the
 * character editor out of the sidecar business.
 */
export interface ReplaceAssetOptions {
	/** What the adjustment controls were set to. Cleared when absent. */
	edits?: ImageEdits;
	/** What the cutout controls were set to. Cleared when absent. */
	tuning?: CutoutTuning;
	/**
	 * Extra blobs to keep beside the new bytes, by kind. A blob replaces what was stored
	 * under that kind. `null` DELETES it. A kind this call does not name — or names as
	 * `undefined` — keeps whatever was there.
	 *
	 * The three-way split exists because "I did not touch the cutout" and "the cutout is
	 * gone" are different saves and used to be the same one: undoing a background removal
	 * cleared `tuning` off the meta and left the alpha map behind it, on disk and in the
	 * manifest.
	 *
	 * `src` is the exception on the write side: written ONCE. An asset that already has
	 * one keeps the one it has, because that is the un-edited picture and what is being
	 * offered here is only the base of the current round — which was itself rendered from
	 * that sidecar. `null` still removes it; write-once guards against an accidental
	 * overwrite, not against a caller that has said outright to drop it.
	 */
	sidecars?: Partial<Record<SidecarKind, Blob | null>>;
}

/**
 * What a pull may legitimately carry onto an asset whose bytes are already here.
 *
 * Deliberately narrower than `AssetMeta`: everything measured from the bytes — `hash`,
 * `bytes`, `w`, `h`, `mime` — is absent, because the precondition for landing this is
 * that the bytes already match. Identity (`name`, `kind`, `tags`, `ownerCharacter`) is
 * absent too; that is the library compare's business, not provenance.
 */
export interface SyncedProvenance {
	edits?: ImageEdits;
	tuning?: CutoutTuning;
	origin?: Frac2;
	/**
	 * Blobs that actually arrived, by kind. Only syncable kinds ever appear here — a
	 * `src` cannot cross the wire, so naming one would be a claim this device could
	 * never make good on.
	 */
	sidecars?: Partial<Record<SidecarKind, Blob>>;
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
	/**
	 * The story id this library belongs to. Empty for the shared library that predates
	 * per-story scoping.
	 */
	readonly scope: string;
	put(file: File, options?: PutAssetOptions): Promise<AssetId>;
	/** Same upload, with the duplicate/transcode report the UI needs. */
	putAsset(file: File, options?: PutAssetOptions): Promise<PutAssetResult>;
	/**
	 * Writes bytes and metadata into the library verbatim — the bundle import path
	 * (spec 08). It skips `prepareUpload`, because a `.sliders.zip` carries what the
	 * library already stored: re-encoding a still to WebP would change the bytes,
	 * invalidate the `hash` the manifest travelled with, and cost time on data that
	 * is usually WebP already. The hash is not recomputed either — the importer has
	 * already checked it against the bundle manifest.
	 *
	 * Unlike `putAsset` this does **not** dedupe by content hash and does not enforce
	 * unique names. Which of a bundle's assets are duplicates of library ones, and what
	 * a name clash means, are the importer's decisions; by the time it calls here it
	 * has decided and wants this asset stored.
	 *
	 * `meta.id` is kept when it is free, so bundle references need no remapping. When
	 * it is taken a fresh id is minted, which is why the stored meta comes back: the
	 * caller must repoint its references at the id actually used.
	 */
	importAsset(meta: AssetMeta, blob: Blob): Promise<AssetMeta>;
	get(id: AssetId): Promise<Blob | undefined>;
	url(id: AssetId): Promise<string | undefined>;
	meta(id: AssetId): Promise<AssetMeta | undefined>;
	list(filter?: AssetFilter): Promise<AssetMeta[]>;
	/**
	 * Swaps an asset's pixels while keeping its id, so every scene already
	 * pointing at it follows along. Its name, kind, tags and character
	 * ownership survive; everything measured from the bytes is re-derived.
	 */
	replace(
		id: AssetId,
		file: File,
		options?: ReplaceAssetOptions
	): Promise<AssetMeta>;
	/**
	 * An asset's extra blob, or undefined when it has none of that kind.
	 *
	 * Only the asset editor asks. Nothing that draws, syncs or exports a story has any
	 * business here: the asset's own bytes are always the finished picture.
	 */
	sidecar(id: AssetId, kind: SidecarKind): Promise<Blob | undefined>;
	/**
	 * Lands another device's provenance — edit settings and the sidecar blobs that
	 * travelled with them — onto an asset this library already holds the bytes for.
	 *
	 * NOT `importAsset`. That one blanks `edits`, `tuning` and `sidecars` on purpose: a
	 * bundle ships baked bytes and no sidecars, so keeping the settings would tell the
	 * editor to render an edit that is already in the pixels. A pull is the opposite
	 * case — the bytes are known to match and the sidecars did come along — so the
	 * settings are exactly what must survive.
	 *
	 * Bytes and `hash` are never touched; that the bytes already agree is the
	 * precondition for calling this at all.
	 *
	 * Syncable kinds are RECONCILED against what arrived: a blob is written, and a kind
	 * that no longer arrives is deleted, blob and entry. The deletion is the feature —
	 * it is how "the author undid the background removal" reaches this machine.
	 * Non-syncable kinds are left exactly as they were, which is what stops the sync
	 * looping: this device's `src` never crossed the wire, so the sender could neither
	 * have sent it nor have meant to drop it.
	 */
	applySyncedProvenance(
		id: AssetId,
		incoming: SyncedProvenance
	): Promise<AssetMeta>;
	/**
	 * Edits metadata in place. A `name` that another asset or character already answers to
	 * THROWS rather than being quietly numbered: a rename is a deliberate act, and an author
	 * who typed `lamp` and got `lamp-2` would go on writing `lamp` in their scenes.
	 */
	update(id: AssetId, changes: Partial<AssetMeta>): Promise<AssetMeta>;
	remove(id: AssetId): Promise<void>;
	/**
	 * Saves a character. Updating one that already exists is always fine; creating one whose
	 * id an ASSET NAME already answers to throws, for the same reason `update` does — scene
	 * YAML addresses assets by name and characters by id out of one namespace.
	 *
	 * Callers that mint an id from user text (the New Character field) should run it through
	 * `uniqueName(id, await store.takenNames())` first, so the common case is a free id
	 * rather than an error.
	 */
	putCharacter(character: Character): Promise<Character>;
	/**
	 * Every name a scene can address: asset names, character frames included, plus character
	 * ids. The namespace `uniqueName` dedupes against.
	 */
	takenNames(): Promise<Set<string>>;
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
