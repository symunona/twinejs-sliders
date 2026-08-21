/**
 * Copying one asset, or one character, out of another story's library into this one.
 *
 * Libraries are per story, so art does not follow the author from story to story any more.
 * That is the point — but it also means the only way to reuse a background is to say so,
 * one piece at a time, which is what this does.
 *
 * The rules for what happens on arrival are not re-invented here: the bundle importer
 * already decided them (see apply-bundle.ts), and an author reusing their own art across
 * two stories deserves the same answers as one importing a `.sliders.zip`. Same bytes
 * already here means reuse; a name already taken by different art means yours is kept,
 * loudly, because scene YAML addresses assets by name and a silent overwrite would repoint
 * every scene that uses it.
 */

import type {AssetStore} from '@sliders/asset-store';
import type {AssetMeta, Character} from '@sliders/scene-types';
import {applyBundlePlan, planBundle} from '../../util/sliders-bundle';

export interface StoryImportResult {
	/** True when bytes were actually written. */
	imported: boolean;
	/**
	 * Whatever the author needs to know: the name that was already taken, the character
	 * that was merged rather than replaced. Empty when the copy was uneventful.
	 */
	warnings: string[];
}

/** Reads an asset's bytes, or explains why it could not. */
async function bytesOf(source: AssetStore, meta: AssetMeta): Promise<Blob> {
	const blob = await source.get(meta.id);

	if (!blob) {
		throw new Error(
			`The other story's library has no image data for "${meta.name}".`
		);
	}

	return blob;
}

/** Copies one loose asset across. */
export async function importAssetFromStory(
	source: AssetStore,
	target: AssetStore,
	meta: AssetMeta
): Promise<StoryImportResult> {
	const blob = await bytesOf(source, meta);
	const plan = await planBundle(target, {
		assets: [{meta, blob}],
		characters: []
	});

	await applyBundlePlan(target, plan);

	return {
		imported: plan.assets.some(
			item => item.outcome === 'imported' || item.outcome === 'new-id'
		),
		warnings: plan.warnings
	};
}

/**
 * Copies a character across, frames and all.
 *
 * Every frame, not only the ones some scene names: a character arriving with three of its
 * nine frames makes the character editor useless, which is the same call the bundle
 * exporter makes.
 */
export async function importCharacterFromStory(
	source: AssetStore,
	target: AssetStore,
	character: Character
): Promise<StoryImportResult> {
	const assets: {meta: AssetMeta; blob: Blob}[] = [];
	const missing: string[] = [];

	for (const [name, frame] of Object.entries(character.frames)) {
		const meta = await source.meta(frame.asset);

		if (!meta) {
			// The other library lost the image. Reported rather than fatal: the rest of the
			// character is still worth having, and `remapFrames` drops the dead frame.
			missing.push(name);
			continue;
		}

		assets.push({meta, blob: await bytesOf(source, meta)});
	}

	const plan = await planBundle(target, {assets, characters: [character]});

	await applyBundlePlan(target, plan);

	return {
		imported:
			plan.assets.some(
				item => item.outcome === 'imported' || item.outcome === 'new-id'
			) || plan.characters.length > 0,
		warnings: [
			...plan.warnings,
			...(missing.length > 0
				? [
						`The other story has no image for these frames of "${character.name}", so they were left out: ${missing.join(
							', '
						)}.`
				  ]
				: [])
		]
	};
}

/**
 * Is this asset already here?
 *
 * Bytes, not name: the same picture stored under two names is one asset as far as every
 * other part of the library is concerned, and `ownerCharacter` joins in because a sprite
 * used as a loose prop and as a character frame really are two entries (see `dedupeKey`).
 */
export function assetIsPresent(
	meta: AssetMeta,
	present: AssetMeta[]
): boolean {
	return present.some(
		local =>
			local.hash === meta.hash &&
			(local.ownerCharacter ?? '') === (meta.ownerCharacter ?? '')
	);
}
