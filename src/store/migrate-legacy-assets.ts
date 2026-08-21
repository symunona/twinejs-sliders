/**
 * Moving the old shared asset library into the per-story ones.
 *
 * Before scoping there was a single library behind every story in the browser, so art
 * uploaded while writing one story turned up in the asset manager of all the others — and
 * a `bg: forest` in two stories meant the same picture whether the author wanted that or
 * not. Assets are now stored per story id (see `slidersAssetStore`), which would leave
 * every existing story pointing at a library it can no longer see.
 *
 * So: for each story, work out what it actually references — the same resolution the
 * bundle exporter does, names and all — and copy those assets and characters into that
 * story's own library, ids intact so no scene has to be rewritten.
 *
 * The old library is left exactly where it is. Nothing else reads it, but the asset
 * manager's Import tab offers it as a source, which is the only way to reach art no story
 * happened to name — a background uploaded for a scene never written, say.
 */

import type {AssetStore} from '@sliders/asset-store';
import {
	LEGACY_ASSET_SCOPE,
	slidersAssetStore
} from '../dialogs/sliders-assets/asset-store-context';
import {collectAssetRefs, resolveBundleRefs} from '../util/sliders-bundle';
import type {Story} from './stories';

/**
 * Set once the copy has run. Not a preference: prefs are exported and imported between
 * browsers, and this records what happened to storage in *this* one.
 */
const MIGRATION_KEY = 'sliders.assets.scoped';

export interface LegacyAssetMigration {
	/** Assets copied, across every story. */
	assets: number;
	characters: number;
	/** Stories that got something. */
	stories: number;
}

function alreadyRun(): boolean {
	try {
		return window.localStorage.getItem(MIGRATION_KEY) === 'done';
	} catch {
		// Private-mode storage. Re-running is cheap — every story that already has a
		// library is skipped — so treat it as not run.
		return false;
	}
}

function markRun(): void {
	try {
		window.localStorage.setItem(MIGRATION_KEY, 'done');
	} catch {
		// See above.
	}
}

async function copyStoryAssets(
	legacy: AssetStore,
	story: Story
): Promise<LegacyAssetMigration> {
	const target = slidersAssetStore(story.id);
	const existing = await target.list({includeFrames: true});

	// A story that already has its own art was either created after scoping or copied
	// into once already. Either way its library is the authority, and a second pass must
	// not lay the old shared one on top of it.
	if (existing.length > 0) {
		return {assets: 0, characters: 0, stories: 0};
	}

	const resolved = await resolveBundleRefs(legacy, collectAssetRefs(story));
	let assets = 0;

	for (const meta of resolved.assets) {
		const blob = await legacy.get(meta.id);

		if (!blob) {
			// Metadata without bytes. The old library is not being deleted, so this is
			// recoverable by hand; failing the whole migration over it is not worth it.
			console.warn(
				`Sliders: the old library has no image data for "${meta.name}", so it was not copied into "${story.name}".`
			);
			continue;
		}

		// Ids survive: the target library is empty, so `importAsset` keeps them, and
		// every scene that names an id still resolves.
		await target.importAsset(meta, blob);
		assets++;
	}

	// After the frames, so `putCharacter` finds them to stamp ownership onto.
	for (const character of resolved.characters) {
		await target.putCharacter(character);
	}

	return {
		assets,
		characters: resolved.characters.length,
		stories: assets > 0 || resolved.characters.length > 0 ? 1 : 0
	};
}

/**
 * Copies each story's share of the old shared library into it. Runs once per browser,
 * then never again.
 *
 * Never throws: a story the copy chokes on is one story with missing art, and blocking
 * the app on it would cost the author every other story too.
 */
export async function migrateLegacyAssets(
	stories: Story[]
): Promise<LegacyAssetMigration> {
	const total: LegacyAssetMigration = {assets: 0, characters: 0, stories: 0};

	if (alreadyRun()) {
		return total;
	}

	const legacy = slidersAssetStore(LEGACY_ASSET_SCOPE);
	const [assets, characters] = await Promise.all([
		legacy.list({includeFrames: true}),
		legacy.listCharacters()
	]);

	if (assets.length === 0 && characters.length === 0) {
		markRun();
		return total;
	}

	for (const story of stories) {
		try {
			const report = await copyStoryAssets(legacy, story);

			total.assets += report.assets;
			total.characters += report.characters;
			total.stories += report.stories;
		} catch (error) {
			console.error(
				`Sliders: could not copy the old shared library into "${story.name}"`,
				error
			);
		}
	}

	markRun();
	return total;
}
