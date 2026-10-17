/**
 * What to download, in what order: a priority tree over the story's link graph.
 *
 * Tier 0 is the art of the passage the reader opens on. Tier 1 is the art of every passage
 * one click away that tier 0 did not already hold, tier 2 two clicks away, and so on —
 * breadth first, so the next scene the reader can reach is always downloaded before one
 * they cannot reach yet. Art no reachable passage names comes last, in one `unreached`
 * tier: the manifest can carry a character's every pose, and a story can still show them
 * through a path the walk cannot see.
 *
 * Pure: no Chapbook, no DOM, no fetch. `preload.ts` feeds it the story and runs it.
 */

import {catalogFromManifest, linksOf, resolveSceneAssets} from '@sliders/story-map';
import {matchPassageName} from '@sliders/scene-types';
import type {AssetMeta, Character, Scene} from '@sliders/scene-types';

export interface PlanAsset {
	url: string;
	/** Manifest name when there is one, else the key the url was filed under. */
	label: string;
	bytes: number;
	mime?: string;
}

export interface PlanTier {
	/** Clicks from the start passage. The `unreached` tier is one past the deepest. */
	depth: number;
	unreached?: boolean;
	/** Passages first reached at this depth, in visiting order. */
	passages: string[];
	/** Art first needed at this depth. Each url sits in exactly one tier. */
	assets: PlanAsset[];
}

export interface PreloadPlan {
	start: string;
	tiers: PlanTier[];
	/** Passage name -> every url its scene draws, `from:` inheritance included. */
	byPassage: Map<string, string[]>;
	/** Passages whose scene plays music or a sound effect (`from:` included). */
	sound: Set<string>;
}

export interface PlanInput {
	passages: {name: string; text: string}[];
	/** Where the reader opens. Unknown or absent: the first passage. */
	start?: string;
	/** Passage name -> its scene as authored (`scene-graph.ts`). */
	scenes: (name: string) => Scene | undefined;
	assets: AssetMeta[];
	characters: Character[];
	/** Manifest key (name or id) -> url. */
	urls: Record<string, string>;
}

export async function buildPreloadPlan(input: PlanInput): Promise<PreloadPlan> {
	const names = input.passages.map(passage => passage.name);
	const textOf = new Map(input.passages.map(p => [p.name, p.text]));
	const catalog = await catalogFromManifest({
		assets: input.assets.map(meta => ({...meta, tags: meta.tags ?? []})),
		characters: input.characters,
		missing: [],
		rev: 0,
		version: 1
	});
	const metaById = new Map(input.assets.map(meta => [meta.id, meta]));
	const metaByName = new Map(input.assets.map(meta => [meta.name, meta]));

	function asset(key: string): PlanAsset | undefined {
		const url = input.urls[key];

		if (typeof url !== 'string') {
			return undefined;
		}

		const meta = metaById.get(key) ?? metaByName.get(key);

		return {bytes: meta?.bytes ?? 0, label: meta?.name ?? key, mime: meta?.mime, url};
	}

	const byPassage = new Map<string, string[]>();
	const sound = new Set<string>();
	const assetsOf = (name: string): PlanAsset[] => {
		const scene = input.scenes(name);

		if (!scene) {
			byPassage.set(name, []);
			return [];
		}

		const out: PlanAsset[] = [];

		for (const row of resolveSceneAssets(scene, catalog, {scenes: input.scenes})) {
			if (row.key === 'music' || row.key === 'sfx') {
				sound.add(name);
			}

			const found = (row.id && asset(row.id)) || asset(row.name);

			if (found && !out.some(a => a.url === found.url)) {
				out.push(found);
			}
		}

		byPassage.set(
			name,
			out.map(a => a.url)
		);
		return out;
	};

	const start =
		(input.start && matchPassageName(names, input.start)) ?? names[0] ?? '';
	const tiers: PlanTier[] = [];
	const taken = new Set<string>();
	const visited = new Set<string>(start ? [start] : []);
	let frontier = start ? [start] : [];

	for (let depth = 0; frontier.length > 0; depth++) {
		const tier: PlanTier = {assets: [], depth, passages: frontier};
		const next: string[] = [];

		for (const name of frontier) {
			for (const found of assetsOf(name)) {
				if (!taken.has(found.url)) {
					taken.add(found.url);
					tier.assets.push(found);
				}
			}

			for (const target of linksOf({
				id: name,
				name,
				tags: [],
				text: textOf.get(name) ?? ''
			})) {
				const resolved = matchPassageName(names, target);

				if (resolved && !visited.has(resolved)) {
					visited.add(resolved);
					next.push(resolved);
				}
			}
		}

		tiers.push(tier);
		frontier = next;
	}

	// Unreached passages still get a `byPassage` entry: a `go()` from story code can land
	// anywhere, and the navigation gate asks by name.
	const rest = names.filter(name => !visited.has(name));
	const unreached: PlanTier = {
		assets: [],
		depth: tiers.length,
		passages: rest,
		unreached: true
	};

	for (const name of rest) {
		for (const found of assetsOf(name)) {
			if (!taken.has(found.url)) {
				taken.add(found.url);
				unreached.assets.push(found);
			}
		}
	}

	for (const key of Object.keys(input.urls)) {
		const found = asset(key);

		if (found && !taken.has(found.url)) {
			taken.add(found.url);
			unreached.assets.push(found);
		}
	}

	if (unreached.assets.length > 0 || rest.length > 0) {
		tiers.push(unreached);
	}

	return {byPassage, sound, start, tiers};
}
