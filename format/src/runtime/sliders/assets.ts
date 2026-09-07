/**
 * Where a published story's art comes from.
 *
 * Twine writes two hidden passages when it publishes (see `util/sliders-manifest.ts` in
 * the editor):
 *
 *     SlidersCast    {characters: Character[]}
 *     SlidersAssets  {assets: AssetMeta[], urls: {key: url}}
 *
 * Scene YAML addresses art by NAME (`bg: lighthouse-night`) while character frames carry
 * asset IDS, so the editor emits every asset under both keys and this is a bare map read.
 *
 * A story published before the manifests existed — or one played straight out of the
 * editor's Test button with no art at all — has neither passage. That is what
 * `createStubResolver()` is for: labelled rectangles instead of nothing.
 */

import {createStubResolver} from '@sliders/render-dom';
import type {AssetMeta, Character} from '@sliders/scene-types';
import {createLoggers} from '../logger';
import {passageNamed} from '../story';

const {warn} = createLoggers('scene');

const CAST_PASSAGE = 'SlidersCast';
const ASSETS_PASSAGE = 'SlidersAssets';

interface Manifests {
	assets: Record<string, AssetMeta>;
	characters: Record<string, Character>;
	urls: Record<string, string>;
	/** True when the story carries no manifest at all, i.e. fall back to stubs. */
	empty: boolean;
}

let manifests: Manifests | undefined;
let stubs: ReturnType<typeof createStubResolver> | undefined;

function manifestJson(name: string): Record<string, unknown> | undefined {
	const passage = passageNamed(name);

	if (!passage || passage.source.trim() === '') {
		return undefined;
	}

	try {
		return JSON.parse(passage.source);
	} catch (error) {
		warn(
			`The ${name} passage isn't valid JSON, so its manifest was ignored. (${
				(error as Error).message
			})`
		);
		return undefined;
	}
}

function byId<T extends {id: string}>(
	source: unknown,
	key: string
): Record<string, T> {
	const list = Array.isArray(source)
		? source
		: (source as Record<string, unknown> | undefined)?.[key];
	const out: Record<string, T> = {};

	if (Array.isArray(list)) {
		for (const entry of list) {
			if (entry && typeof entry.id === 'string') {
				out[entry.id] = entry;
			}
		}
	}

	return out;
}

function load(): Manifests {
	if (manifests) {
		return manifests;
	}

	const cast = manifestJson(CAST_PASSAGE);
	const assets = manifestJson(ASSETS_PASSAGE);
	const urls = assets?.urls;

	manifests = {
		assets: byId<AssetMeta>(assets, 'assets'),
		characters: byId<Character>(cast, 'characters'),
		empty: cast === undefined && assets === undefined,
		urls: urls && typeof urls === 'object' ? (urls as Record<string, string>) : {}
	};

	return manifests;
}

function stubResolver() {
	stubs ??= createStubResolver();
	return stubs;
}

/** Called once per page load, before anything reads a manifest. */
export function resetManifests(): void {
	manifests = undefined;
	stubs = undefined;
}

export const manifestResolver = {
	async character(id: string) {
		const found = load().characters[id];

		return found ?? (load().empty ? stubResolver().character(id) : undefined);
	},
	async meta(key: string) {
		const found = load().assets[key];

		return found ?? (load().empty ? stubResolver().meta(key) : undefined);
	},
	async url(key: string) {
		const found = load().urls[key];

		return found ?? (load().empty ? stubResolver().url(key) : undefined);
	}
};
