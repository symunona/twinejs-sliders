/**
 * The `.sliders.zip` bundle — a story plus the assets it references, in one file.
 *
 * See docs/sliders/08-export-import-bundle.md. The short version: the asset library is
 * global and origin-bound, so a story exported as HTML arrives on another machine with
 * every `bg:` and every character unresolved. This carries them along.
 */

import type {AssetId, AssetMeta, Character} from '@sliders/scene-types';
import type {Story} from '../../store/stories';

export const BUNDLE_FORMAT = 'sliders-bundle';
export const BUNDLE_VERSION = 1;
export const BUNDLE_EXTENSION = '.sliders.zip';

/** Entry names inside the zip. */
export const STORY_JSON = 'story.json';
export const STORY_HTML = 'story.html';
export const BUNDLE_MANIFEST = 'sliders.json';
export const ASSET_DIR = 'assets/';

// ---------------------------------------------------------------------------
// What the scanner finds
// ---------------------------------------------------------------------------

/**
 * Every asset-ish name written in a story's scene blocks. Deduped and sorted, so tests can
 * assert on them directly.
 *
 * Three buckets because they resolve by different rules — see `resolveBundleRefs`.
 */
export interface SceneAssetRefs {
	/** Where a plain asset is expected: `bg:` and `kind: 'prop'` entity refs. */
	assetRefs: string[];
	/**
	 * Asset names a scene implies rather than names: an `id:` standing in for a missing
	 * `bg:`. Bundled when they resolve, silently dropped when they do not — the author
	 * never asked for them, so they are not `unresolved`. Optional: bundles and callers
	 * written before implied backdrops existed simply have none.
	 */
	optionalAssetRefs?: string[];
	/** `kind: 'cast'` entity refs. These are character ids, not asset names. */
	characterRefs: string[];
	/**
	 * `kind: 'auto'` entity refs — an `entities:` entry, where the author never said whether
	 * the name is a character or an asset and the parser has no library to ask.
	 *
	 * Its own bucket rather than a name in both of the others, because it is ONE candidate
	 * resolved two ways: character first, asset second, and only `unresolved` when both
	 * miss. Filed under `assetRefs` as well it would report a perfectly good character as a
	 * missing asset. Optional: bundles written before `entities:` existed have none.
	 */
	autoRefs?: string[];
	/**
	 * `fx:` ids. Lossy: `assetFragment` writes `fx: [{id: rain}]` for an asset named
	 * `fx/rain`, because `entityKey()` slugifies the last path segment. Matching has to
	 * try the mangled form too.
	 */
	fxRefs: string[];
	/**
	 * Frame names seen in `frame:` on entities and beat patches, keyed by the entity id
	 * that carried them. Only used to report frames a character does not have — a
	 * referenced character contributes all of its frames regardless.
	 */
	frameRefs: Record<string, string[]>;
}

export function emptySceneAssetRefs(): SceneAssetRefs {
	return {
		assetRefs: [],
		characterRefs: [],
		frameRefs: {},
		fxRefs: [],
		optionalAssetRefs: []
	};
}

// ---------------------------------------------------------------------------
// sliders.json
// ---------------------------------------------------------------------------

/** An asset in the manifest: its `AssetMeta` verbatim, plus where the bytes live. */
export interface BundleAssetEntry extends AssetMeta {
	/** Zip entry path, e.g. `assets/a_8f21.webp`. */
	file: string;
}

export interface BundleManifest {
	format: typeof BUNDLE_FORMAT;
	version: number;
	creator: {name: string; version: string};
	story: {id: string; ifid: string; name: string};
	assets: BundleAssetEntry[];
	characters: Character[];
	/** Names written in scene YAML that resolved to nothing in the library. */
	unresolved: string[];
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** An asset and its bytes, on the way into or out of a zip. */
export interface BundleAsset {
	meta: AssetMeta;
	blob: Blob;
}

export interface ExportReport {
	assetCount: number;
	characterCount: number;
	/** Names the story references that the library does not have. Never fatal. */
	unresolved: string[];
	/**
	 * `fx:` refs that matched more than one asset once mangled through `entityKey`. Not
	 * `unresolved` — something was found and does ride along, it just may be the wrong
	 * `rain`. Worth showing, because only the author knows which one they meant.
	 */
	ambiguousFx: string[];
	/** Size of the finished zip. */
	bytes: number;
}

export interface ExportedBundle {
	blob: Blob;
	filename: string;
	report: ExportReport;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** A bundle that has been read and validated, but not written to the library. */
export interface BundleContents {
	manifest: BundleManifest;
	/** Usually one. Read from `story.json`, falling back to `story.html`. */
	stories: Story[];
	assets: BundleAsset[];
	characters: Character[];
	/** Non-fatal problems: hash mismatches, a missing blob, an unreadable story.json. */
	warnings: string[];
}

/**
 * What will happen to one incoming asset. Scene YAML resolves assets by NAME, so an
 * incoming asset must never be renamed — that would silently repoint the scenes of the
 * story arriving with it.
 *
 * | outcome | when |
 * |---|---|
 * | `reused` | same content hash already in the library. Remap and move on. |
 * | `imported` | name and id both free. |
 * | `new-id` | name free, id taken. Import under a fresh id, remap references. |
 * | `kept-existing` | name taken by different bytes. Keep the local asset, drop the incoming one, warn. |
 */
export type AssetOutcome = 'reused' | 'imported' | 'new-id' | 'kept-existing';

export interface AssetPlanItem {
	/** The bundle's metadata, with `id` already set to `targetId`. */
	meta: AssetMeta;
	blob: Blob;
	outcome: AssetOutcome;
	/** Id this asset will have in the local library. */
	targetId: AssetId;
	/** Id it had in the bundle. Differs from `targetId` on `reused` and `new-id`. */
	bundleId: AssetId;
	/** Set when the outcome is worth showing the author. */
	reason?: string;
}

/**
 * A character id is written literally in every scene that casts it, so a clash cannot be
 * renamed either. Merge frames instead: add what is missing, keep what is there.
 */
export type CharacterOutcome = 'imported' | 'merged';

export interface CharacterPlanItem {
	/** Frame asset ids already remapped to local ones. */
	character: Character;
	outcome: CharacterOutcome;
	/** Frame names this import adds to an existing character. */
	addedFrames: string[];
	/** Frame names that clashed and were left alone. */
	keptFrames: string[];
}

export interface BundlePlan {
	assets: AssetPlanItem[];
	characters: CharacterPlanItem[];
	warnings: string[];
}
