import {
	AssetStore,
	defaultCharacter,
	newPoseAnchors,
	slugify
} from '@sliders/asset-store';
import {Character} from '@sliders/scene-types';
import {Generation} from './generation-store';

/** What a generated image can become when it leaves the history. */
export type SaveTarget = 'bg' | 'object' | 'character';

function extensionFor(mime: string): string {
	return mime === 'image/jpeg' ? 'jpg' : mime.replace(/^image\//, '') || 'png';
}

/** The store takes files, not blobs, and derives a fallback name from the filename. */
export function generationFile(generation: Generation, name: string): File {
	const mime = generation.blob.type || 'image/png';

	return new File([generation.blob], `${name}.${extensionFor(mime)}`, {
		type: mime
	});
}

/** A character id nobody is using yet, so saving twice makes two characters. */
async function freeCharacterId(
	store: AssetStore,
	wanted: string
): Promise<string> {
	const taken = new Set((await store.listCharacters()).map(one => one.id));

	if (!taken.has(wanted)) {
		return wanted;
	}

	for (let suffix = 2; ; suffix++) {
		if (!taken.has(`${wanted}-${suffix}`)) {
			return `${wanted}-${suffix}`;
		}
	}
}

export interface SaveResult {
	/**
	 * True when the library already held these exact bytes AS THIS KIND, and pointed at
	 * the existing asset instead of making a second copy. Saving one generation as both a
	 * background and an object still gets two assets: they live on two tabs.
	 *
	 * The caller is expected to offer a way out (`allowDuplicate`), because the author
	 * who meant a second copy under a second name has no other move.
	 */
	duplicate: boolean;
	/** How the save should read in the tile's badges. */
	label: string;
	/**
	 * What a scene would name this by, so the asset manager can be asked to show it --
	 * an asset name, or a character id. The answer to "then where did it go?".
	 */
	ref: string;
}

export interface SaveOptions {
	/** Store a second copy even if the library already holds these bytes. */
	allowDuplicate?: boolean;
}

/**
 * Puts a generated image into the asset library.
 *
 * A character is not just an asset: it needs an id, a pose, and a size measured from
 * the image, or the character editor opens on something it can't draw. Doing that here
 * means the generator can offer it as one click rather than sending the author off to
 * create a character and then upload into it.
 */
export async function saveGeneration(
	store: AssetStore,
	generation: Generation,
	target: SaveTarget,
	name: string,
	options: SaveOptions = {}
): Promise<SaveResult> {
	if (target !== 'character') {
		const result = await store.putAsset(generationFile(generation, name), {
			allowDuplicate: options.allowDuplicate,
			kind: target,
			name
		});

		return {
			duplicate: result.duplicate,
			label: `${result.meta.kind}: ${result.meta.name}`,
			ref: result.meta.name
		};
	}

	const id = await freeCharacterId(store, slugify(name));
	const image = await store.putAsset(generationFile(generation, name), {
		// A character is minted under a free id every time, so its pose image is always a
		// new one -- there is no existing pose of THIS character to dedupe against.
		allowDuplicate: true,
		kind: 'frame',
		name: `${id}/idle`,
		ownerCharacter: id
	});
	const character: Character = {
		...defaultCharacter(id),
		// Anchors are per pose, and this is the character's only one, so it carries the
		// starting rig the character editor would have given it.
		poses: {idle: {anchors: newPoseAnchors(undefined), asset: image.id}},
		// Measured from the image, so the character's origin and anchors land where
		// the editor draws them rather than on the 512x1024 placeholder.
		size: {h: image.meta.h, w: image.meta.w}
	};

	await store.putCharacter(character);
	return {duplicate: false, label: `character: ${id}`, ref: id};
}
