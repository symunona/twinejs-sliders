import {
	AssetStore,
	nameFromFilename,
	newFrameAnchors,
	slugify
} from '@sliders/asset-store';
import {Character} from '@sliders/scene-types';

/** `preferred`, or `preferred-2`, `preferred-3`, … until the character has no such frame. */
export function uniqueFrameName(
	preferred: string,
	frames: Character['frames']
): string {
	if (!frames[preferred]) {
		return preferred;
	}

	let suffix = 2;

	while (frames[`${preferred}-${suffix}`]) {
		suffix++;
	}

	return `${preferred}-${suffix}`;
}

/**
 * Uploads each file as a new frame of `character` and returns the frames map to save.
 *
 * The frame's asset is named `<character id>-<frame name>`, NOT after the file. A frame is
 * an ordinary asset, so its name shares the one namespace scene YAML reads — and a file
 * called `mira.png` dropped to make a character called `mira` would otherwise take that
 * name out from under the character it is a frame of, and `putCharacter` would throw.
 * Scenes address a frame through its character (`frame: wave`), never by asset name, so
 * nothing is lost by naming it after its owner.
 *
 * Writes the assets only. The caller owns the character record--the character editor has a
 * draft to fold this into, and a drop onto a tile has no draft at all.
 */
export async function framesFromFiles(
	store: AssetStore,
	character: Pick<Character, 'id' | 'frames'>,
	files: File[]
): Promise<Character['frames']> {
	const frames = {...character.frames};

	for (const file of files) {
		// The renderer falls back to `idle` when an entity names no frame, so a character's
		// very first frame takes that name whatever the file was called. Otherwise a
		// character built by dropping `mira.png` would have exactly one frame, called
		// `mira`, and render nothing until a scene asked for it by name.
		const name =
			Object.keys(frames).length === 0
				? 'idle'
				: uniqueFrameName(slugify(nameFromFilename(file.name)), frames);

		try {
			const result = await store.putAsset(file, {
				kind: 'frame',
				name: `${character.id}-${name}`,
				ownerCharacter: character.id
			});

			// A new frame comes in rigged, copying whatever the character's other frames
			// already use — the poses of one sprite sheet are variations on one drawing, so
			// that is far closer to right than the bare defaults, and the author nudges the
			// anchors that actually moved.
			frames[name] = {
				anchors: newFrameAnchors({frames}),
				asset: result.id
			};
		} catch (error) {
			console.error(`Could not add ${file.name} as a frame`, error);
		}
	}

	return frames;
}
