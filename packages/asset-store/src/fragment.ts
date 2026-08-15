import type {AssetMeta, Character} from '@sliders/scene-types';
import {slugify} from './ids';

/**
 * The scene-YAML line a tile copies to the clipboard (spec 03). Copying an id would be
 * useless — what an author wants is the line they are about to paste into a passage.
 */
export function assetFragment(meta: AssetMeta): string {
	switch (meta.kind) {
		case 'bg':
			return `bg: ${meta.name}`;

		case 'object':
			return `${entityKey(meta.name)}: {at: 0}`;

		case 'fx':
			return `fx: [{id: ${entityKey(meta.name)}, amount: 1}]`;

		case 'frame':
			// Frames are addressed through their character, never on their own.
			return meta.ownerCharacter
				? `${meta.ownerCharacter}: {at: 0, frame: ${entityKey(meta.name)}}`
				: `bg: ${meta.name}`;
	}
}

export function characterFragment(character: Character): string {
	const frame = Object.keys(character.frames)[0] ?? 'idle';

	return `${character.id}: {at: 0, frame: ${frame}}`;
}

/** `props/candle` addresses an entity named `candle`. */
export function entityKey(name: string): string {
	return slugify(name.split('/').pop() ?? name);
}
