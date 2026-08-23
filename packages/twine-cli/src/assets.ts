/**
 * Per-scene asset resolution (spec 12 §4).
 *
 * The manifest answers "what exists". This answers the harder question — "what does THIS
 * scene reach" — which is the one an agent asks before generating art, because the gap
 * between the two is the work list.
 *
 * The walk is deliberately narrow on frames. A character may carry a dozen poses; a scene
 * names two of them. Handing back the whole character would bury the one frame that is
 * missing under eleven that are fine, so only the frames the scene actually names come
 * back — the entity's `frame:`, any `frame:` a beat patches onto it, and the default the
 * renderer would fall back to. `--all-frames` is the opt-out, and it is also what the
 * "unused" question has to use: an asset is only orphaned if NO pose of NO cast member
 * reaches it.
 */

import {splitSceneRef} from '@sliders/scene-index';
import type {Character, Scene} from '@sliders/scene-types';
import type {AssetMetaRow, Manifest, Source} from './types';

/**
 * Three states, not a boolean, because they are three different jobs: read the bytes,
 * re-upload the bytes, or generate art that does not exist yet.
 */
export type AssetPresence =
	/** In the manifest, blob on disk. */
	| 'present'
	/** In the manifest, bytes gone. Re-`put` it. */
	| 'missing-blob'
	/** The scene names something the manifest has never heard of. */
	| 'unknown';

export interface AssetRow {
	/** Empty string when the reference resolves to nothing in the manifest. */
	id: string;
	kind: string;
	/** Manifest name, or the reference exactly as the scene wrote it. */
	name: string;
	/** Where the scene reached it from: `bg:`, `cast/mira`, `beats/2 patch frame: angry`. */
	via: string;
	path?: string;
	bytes: number;
	hash: string;
	present: AssetPresence;
	/** Reached through `from:` rather than written in this scene (spec 12 §4 step 5). */
	inherited: boolean;
	/**
	 * The YAML key a linter should point its line number at — `bg`, the entity id, the fx
	 * id. Resolution has no text, so it cannot compute a line itself; it can say which key
	 * the caller should go looking for.
	 */
	key: string;
}

export interface AssetCatalog {
	byId: Map<string, AssetMetaRow>;
	/** Manifest name -> row. Scenes address assets by either (`bg: tavern/night`). */
	byName: Map<string, AssetMetaRow>;
	characters: Map<string, Character>;
	/** Asset id -> blob path. Local mode only; a remote source has no paths to give. */
	paths: Map<string, string>;
	/** Manifest entries the store has no bytes for. */
	missing: Set<string>;
	manifest: Manifest;
}

/**
 * What the renderer falls back to when an entity names no frame — see `pickFrameName` in
 * render-dom. Duplicated rather than imported because that module is DOM-only, and the CLI
 * resolving a different frame than the player draws would be a lie in both directions.
 */
const DEFAULT_FRAME_NAME = 'idle';

function defaultFrameName(character: Character): string | undefined {
	const frames = character.frames ?? {};

	if (DEFAULT_FRAME_NAME in frames) {
		return DEFAULT_FRAME_NAME;
	}

	return Object.keys(frames)[0];
}

/** Build the lookup tables once per invocation; every resolution below is then synchronous. */
export async function loadCatalog(
	source: Source,
	storyId: string
): Promise<AssetCatalog> {
	const manifest = await source.manifest(storyId);

	return catalogFromManifest(manifest, async id => source.assetPath(storyId, id));
}

/**
 * The catalog without the I/O, so tests (and any caller that already holds a manifest) do
 * not have to stand up a `Source`.
 */
export async function catalogFromManifest(
	manifest: Manifest,
	assetPath?: (id: string) => Promise<string | undefined>
): Promise<AssetCatalog> {
	const byId = new Map<string, AssetMetaRow>();
	const byName = new Map<string, AssetMetaRow>();
	const characters = new Map<string, Character>();
	const paths = new Map<string, string>();
	const missing = new Set(manifest.missing ?? []);

	for (const asset of manifest.assets ?? []) {
		byId.set(asset.id, asset);

		// First writer wins: manifest names are not enforced unique, and a later duplicate
		// silently shadowing an earlier one would make `bg: tavern/night` resolve to
		// whichever row happened to be appended last.
		if (asset.name !== undefined && !byName.has(asset.name)) {
			byName.set(asset.name, asset);
		}
	}

	for (const raw of manifest.characters ?? []) {
		const character = raw as Character;

		if (character && typeof character.id === 'string') {
			characters.set(character.id, character);
		}
	}

	if (assetPath) {
		for (const asset of manifest.assets ?? []) {
			if (missing.has(asset.id)) {
				continue;
			}

			const path = await assetPath(asset.id);

			if (path !== undefined) {
				paths.set(asset.id, path);
			}
		}
	}

	return {byId, byName, characters, manifest, missing, paths};
}

function presenceOf(catalog: AssetCatalog, id: string): AssetPresence {
	if (!catalog.byId.has(id)) {
		return 'unknown';
	}

	return catalog.missing.has(id) ? 'missing-blob' : 'present';
}

/** A row for something the manifest knows, by id or by name. */
function rowFor(
	catalog: AssetCatalog,
	ref: string,
	via: string,
	key: string,
	inherited: boolean,
	fallbackKind: string
): AssetRow {
	const meta = catalog.byId.get(ref) ?? catalog.byName.get(ref);

	if (!meta) {
		return {
			bytes: 0,
			hash: '',
			id: '',
			inherited,
			key,
			kind: fallbackKind,
			name: ref,
			present: 'unknown',
			via
		};
	}

	return {
		bytes: meta.bytes,
		hash: meta.hash,
		id: meta.id,
		inherited,
		key,
		kind: meta.kind || fallbackKind,
		name: meta.name,
		path: catalog.paths.get(meta.id),
		present: presenceOf(catalog, meta.id),
		via
	};
}

/** Anything a `from:` walk needs: scene id -> the scene as authored. */
export type SceneLookup = (id: string) => Scene | undefined;

export interface ResolveOptions {
	/** Widen every cast entry to the character's whole frame set. */
	allFrames?: boolean;
	/** Resolves `from:` targets. Omit and inheritance is simply not walked. */
	scenes?: SceneLookup;
}

/**
 * Steps 1-5 of spec 12 §4, in order, deduped by asset.
 *
 * Deduping is by asset id (or by the unresolved reference, for things not in the manifest)
 * with first-`via`-wins, so an asset a scene reaches two ways is one row and one file, and
 * a local reference always outranks the inherited one it overrode.
 */
export function resolveSceneAssets(
	scene: Scene,
	catalog: AssetCatalog,
	options: ResolveOptions = {}
): AssetRow[] {
	const out: AssetRow[] = [];
	const seen = new Set<string>();
	const visited = new Set<string>();

	function push(row: AssetRow): void {
		const key = row.id === '' ? `?${row.kind}:${row.name}` : row.id;

		if (seen.has(key)) {
			return;
		}

		seen.add(key);
		out.push(row);
	}

	function walk(current: Scene, inherited: boolean): void {
		// 1 — bg. `null` is a patch clearing an inherited backdrop, not a reference.
		if (typeof current.bg === 'string' && current.bg !== '') {
			push(rowFor(catalog, current.bg, 'bg:', 'bg', inherited, 'bg'));
		}

		for (const [id, patch] of Object.entries(current.entities ?? {})) {
			if (patch === null) {
				continue;
			}

			const ref = patch.ref ?? id;

			if (patch.kind === 'prop') {
				// 2 — props resolve straight to an asset through `ref` (default = the key).
				push(rowFor(catalog, ref, `props/${id}`, id, inherited, 'object'));
				continue;
			}

			// 3 — cast resolve through a character to named frames only.
			const character = catalog.characters.get(ref);

			if (!character) {
				push({
					bytes: 0,
					hash: '',
					id: '',
					inherited,
					key: id,
					kind: 'frame',
					name: ref,
					present: 'unknown',
					via: `cast/${id}`
				});
				continue;
			}

			const wanted: {name: string; via: string}[] = [];

			if (options.allFrames) {
				for (const name of Object.keys(character.frames ?? {})) {
					wanted.push({name, via: `cast/${id} frame: ${name}`});
				}
			} else {
				if (patch.frame) {
					wanted.push({name: patch.frame, via: `cast/${id}`});
				}

				for (const beat of current.beats ?? []) {
					const who = (beat as {who?: string}).who;
					const frame = (beat as {patch?: {frame?: string}}).patch?.frame;

					if (who === id && frame) {
						wanted.push({
							name: frame,
							via: `beats/${beat.index} patch frame: ${frame}`
						});
					}
				}

				const fallback = defaultFrameName(character);

				if (fallback) {
					wanted.push({name: fallback, via: `cast/${id} default frame`});
				}
			}

			for (const want of wanted) {
				const frame = character.frames?.[want.name];

				if (!frame) {
					push({
						bytes: 0,
						hash: '',
						id: '',
						inherited,
						key: id,
						kind: 'frame',
						name: `${ref}/${want.name}`,
						present: 'unknown',
						via: want.via
					});
					continue;
				}

				const row = rowFor(
					catalog,
					frame.asset,
					want.via,
					id,
					inherited,
					'frame'
				);

				// A frame's asset id is authored in the character, not the scene, so when the
				// manifest has lost it the useful name is the pose — `mira/angry`, not the
				// raw id nobody can look up.
				push(row.present === 'unknown' ? {...row, name: `${ref}/${want.name}`} : row);
			}
		}

		// 4 — fx, but only the asset-backed ones. `rain@0.6` is usually a shader the
		// renderer owns; a name the manifest never heard of is not a missing asset.
		for (const fx of current.fx ?? []) {
			const meta = catalog.byId.get(fx.id) ?? catalog.byName.get(fx.id);

			if (meta) {
				push(rowFor(catalog, fx.id, `fx/${fx.id}`, fx.id, inherited, 'fx'));
			}
		}

		// 5 — the same walk over the inherited scene.
		if (current.from && options.scenes) {
			const {id} = splitSceneRef(current.from);

			// The index reports `from:` cycles as errors; resolution just has to survive one.
			if (!visited.has(id)) {
				visited.add(id);

				const parent = options.scenes(id);

				if (parent) {
					walk(parent, true);
				}
			}
		}
	}

	if (scene.id !== undefined) {
		visited.add(scene.id);
	}

	walk(scene, false);

	return out;
}

/** Every manifest entry as a row, for the plain `assets <story>` listing. */
export function catalogRows(catalog: AssetCatalog): AssetRow[] {
	return (catalog.manifest.assets ?? []).map(meta => ({
		bytes: meta.bytes,
		hash: meta.hash,
		id: meta.id,
		inherited: false,
		key: meta.name,
		kind: meta.kind,
		name: meta.name,
		path: catalog.paths.get(meta.id),
		present: presenceOf(catalog, meta.id),
		via: ''
	}));
}

/**
 * Every asset id any scene in the story can reach.
 *
 * Widened to all frames on purpose: "unused" is a claim about the whole story, and a pose
 * that only a beat patch three scenes away names is still named. Narrow resolution is for
 * "what does this scene need"; this is for "what can be deleted".
 */
export function referencedAssetIds(
	scenes: Iterable<Scene>,
	catalog: AssetCatalog
): Set<string> {
	const out = new Set<string>();

	for (const scene of scenes) {
		for (const row of resolveSceneAssets(scene, catalog, {allFrames: true})) {
			if (row.id !== '') {
				out.add(row.id);
			}
		}
	}

	return out;
}

/** Manifest entries nothing in the story names. */
export function unusedAssets(
	scenes: Iterable<Scene>,
	catalog: AssetCatalog
): AssetRow[] {
	const used = referencedAssetIds(scenes, catalog);

	return catalogRows(catalog).filter(row => !used.has(row.id));
}
