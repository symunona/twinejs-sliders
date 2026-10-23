/**
 * Which assets can be a particle: ANY still picture. Pure, so the rule is testable.
 */

import {isVisualKind, type AssetMeta} from '@sliders/scene-types';

/** The pack's sprites carry this tag (`scripts/particle-pack.ts`). Listed first. */
export const PARTICLE_SPRITE_TAG = 'particle-sprite';

/**
 * Still, visual, not an emitter, not a character's pose image (those are reached through
 * the character, and would bury everything else). Pack sprites first, then by name.
 */
export function spriteCandidates(assets: AssetMeta[]): AssetMeta[] {
	const tagged = (asset: AssetMeta) => asset.tags.includes(PARTICLE_SPRITE_TAG);

	return assets
		.filter(
			asset =>
				isVisualKind(asset.kind) &&
				!asset.animated &&
				!asset.particles &&
				!asset.ownerCharacter
		)
		.sort(
			(a, b) =>
				Number(tagged(b)) - Number(tagged(a)) || a.name.localeCompare(b.name)
		);
}

/** Case-insensitive name/tag match. Empty query keeps everything. */
export function filterSprites(assets: AssetMeta[], query: string): AssetMeta[] {
	const q = query.trim().toLowerCase();

	return q
		? assets.filter(
				asset =>
					asset.name.toLowerCase().includes(q) ||
					asset.tags.some(tag => tag.toLowerCase().includes(q))
		  )
		: assets;
}
