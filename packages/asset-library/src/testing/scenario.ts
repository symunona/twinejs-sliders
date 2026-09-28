import {AddAssetOptions} from '../engine';
import {sha256Hex} from '../hash';
import {AssetRecord, CollectionRecord} from '../types';
import {Colour, png} from './fixtures';
import {Browser, World, WorldOptions} from './world';

/** Shared setup for the multi-user suites. */

export interface Team {
	world: World;
	ana: Browser;
	bo: Browser;
	cy: Browser;
	/** `tavern-set`, created by ana, settled. */
	tavern: CollectionRecord;
}

export async function team(
	options: WorldOptions & {names?: string[]} = {}
): Promise<Team> {
	const names = options.names ?? ['ana', 'bo'];
	const [world, ...browsers] = await World.create(names, options);
	const [ana, bo, cy] = browsers;
	const tavern = ana.engine.createCollection({name: 'tavern-set'});

	await world.settle();

	return {world, ana, bo, cy, tavern};
}

/** Adds a PNG as a new asset. Duplicates allowed: tests reuse colours on purpose. */
export async function upload(
	browser: Browser,
	collection: string,
	name: string,
	colour: Colour,
	options: Partial<AddAssetOptions> = {}
): Promise<AssetRecord> {
	const {asset} = await browser.engine.addAsset(png(colour), 'image/png', {
		collection,
		name,
		allowDuplicate: true,
		...options
	});

	if (!asset) {
		throw new Error('upload: addAsset created nothing');
	}

	return asset;
}

export function shaOf(colour: Colour, w?: number, h?: number): Promise<string> {
	return sha256Hex(png(colour, w, h));
}

/** Asset names in a collection, sorted, from one browser's local view. */
export function names(browser: Browser, collection: string): string[] {
	return browser.engine
		.assets(collection)
		.map(asset => asset.name)
		.sort();
}

export function byName(
	browser: Browser,
	collection: string,
	name: string
): AssetRecord | undefined {
	return browser.engine.assets(collection).find(asset => asset.name === name);
}
