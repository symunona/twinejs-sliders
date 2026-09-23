import {
	AssetStore,
	defaultCharacter,
	nameFromFilename,
	newPoseAnchors,
	slugify,
	uniqueName
} from '@sliders/asset-store';
import {Character} from '@sliders/scene-types';

/** `preferred`, or `preferred-2`, `preferred-3`, … until the character has no such pose. */
export function uniquePoseName(
	preferred: string,
	poses: Character['poses']
): string {
	if (!poses[preferred]) {
		return preferred;
	}

	let suffix = 2;

	while (poses[`${preferred}-${suffix}`]) {
		suffix++;
	}

	return `${preferred}-${suffix}`;
}

/**
 * Uploads each file as a new pose of `character` and returns the poses map to save.
 *
 * The pose image is named `<character id>-<pose name>`, NOT after the file. A pose image
 * is an ordinary asset, so its name shares the one namespace scene YAML reads — and a file
 * called `mira.png` dropped to make a character called `mira` would otherwise take that
 * name out from under the character it belongs to, and `putCharacter` would throw.
 * Scenes address a pose through its character (`pose: wave`), never by asset name, so
 * nothing is lost by naming it after its owner.
 *
 * Writes the assets only. The caller owns the character record--the character editor has a
 * draft to fold this into, and a drop onto a tile has no draft at all.
 */
export async function posesFromFiles(
	store: AssetStore,
	character: Pick<Character, 'id' | 'poses'>,
	files: File[]
): Promise<Character['poses']> {
	const poses = {...character.poses};

	for (const file of files) {
		// The renderer falls back to `idle` when an entity names no pose, so a character's
		// very first pose takes that name whatever the file was called. Otherwise a
		// character built by dropping `mira.png` would have exactly one pose, called
		// `mira`, and render nothing until a scene asked for it by name.
		const name =
			Object.keys(poses).length === 0
				? 'idle'
				: uniquePoseName(slugify(nameFromFilename(file.name)), poses);

		try {
			// `kind: 'frame'` is the stored name for a pose image (see `AssetKind`).
			const result = await store.putAsset(file, {
				kind: 'frame',
				name: `${character.id}-${name}`,
				ownerCharacter: character.id
			});

			// A new pose comes in rigged, copying whatever the character's other poses
			// already use — the poses of one sprite sheet are variations on one drawing, so
			// that is far closer to right than the bare defaults, and the author nudges the
			// anchors that actually moved.
			poses[name] = {
				anchors: newPoseAnchors({poses}),
				asset: result.id
			};
		} catch (error) {
			console.error(`Could not add ${file.name} as a pose`, error);
		}
	}

	return poses;
}

/**
 * Saves one file as a brand new character whose only pose is that image, and returns the
 * id — which is the token a scene writes, so a caller that is placing the character on the
 * stage has what it needs.
 *
 * `taken` is MUTATED with the id that was used, so a caller looping over a batch of files
 * mints a free id for each without asking the store again. Asset names count, not just
 * other character ids: a scene addresses assets by name and characters by id out of one
 * namespace, and `putCharacter` throws on a clash rather than quietly renaming.
 */
export async function characterFromFile(
	store: AssetStore,
	file: File,
	taken: Set<string>
): Promise<string> {
	const id = uniqueName(slugify(nameFromFilename(file.name)), taken);

	taken.add(id);

	const poses = await posesFromFiles(store, {id, poses: {}}, [file]);

	await store.putCharacter({
		...defaultCharacter(id),
		poses
	});

	return id;
}
