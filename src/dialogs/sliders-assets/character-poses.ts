import {
	AssetStore,
	defaultCharacter,
	nameFromFilename,
	newPoseAnchors,
	slugify,
	uniqueName
} from '@sliders/asset-store';
import {
	AssetId,
	Character,
	CharacterPose,
	PoseFit,
	PoseStep
} from '@sliders/scene-types';

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

/** One image of an imported pose: a file, or a slice cut out of a sheet. */
export interface ImportImage {
	blob: Blob;
	/** Only for the log when an upload fails. */
	label: string;
	/** Written as the step's own fit (or the still's). Align feet fills it in. */
	fit?: PoseFit;
}

/** One pose the Import set review table settled on. */
export interface ImportPose {
	name: string;
	images: ImportImage[];
	/** Seconds per step; absent = the default hold. Steps only. */
	dur?: number;
	/** Steps only. Absent = loops. */
	loop?: boolean;
}

/**
 * The names an Import set's poses will be saved under, index for index. The review table
 * shows these, so what it shows is what lands.
 *
 * - A name that clashes with an existing pose becomes `walk-2`.
 * - A character with no poses yet gets `idle`: the renderer falls back to it. If the set
 *   has no `idle`, its first pose takes the name.
 */
export function plannedPoseNames(
	names: string[],
	existing: Character['poses']
): string[] {
	const taken: Character['poses'] = {...existing};
	const wasEmpty = Object.keys(existing).length === 0;
	const slugs = names.map(name => slugify(name));
	// A character with no poses gets `idle` first: its own, else the set's first pose.
	const idle = wasEmpty ? Math.max(0, slugs.indexOf('idle')) : -1;
	const result: string[] = new Array(names.length);
	const order = [...slugs.keys()].sort((a, b) =>
		a === idle ? -1 : b === idle ? 1 : a - b
	);

	for (const index of order) {
		const name = uniquePoseName(index === idle ? 'idle' : slugs[index], taken);

		result[index] = name;
		// Placeholder: only the key matters to `uniquePoseName`.
		taken[name] = {};
	}

	return result;
}

/**
 * Uploads an Import set and returns the poses map to save. Like `posesFromFiles`, writes
 * assets only; the caller owns the character record.
 *
 * - Names per `plannedPoseNames`.
 * - One image = a still (`asset`); more = `steps`.
 * - Images are named `<character id>-<pose>` (still) or `<character id>-<pose>-<n>`.
 */
export async function importPoseSet(
	store: AssetStore,
	character: Pick<Character, 'id' | 'poses'>,
	set: ImportPose[]
): Promise<Character['poses']> {
	const poses = {...character.poses};
	const names = plannedPoseNames(
		set.map(pose => pose.name),
		character.poses
	);
	// `idle` first in the map, so a character's first pose is idle.
	const ordered = set
		.map((item, index) => ({item, name: names[index]}))
		.sort((a, b) => (a.name === 'idle' ? -1 : b.name === 'idle' ? 1 : 0));

	for (const {item, name} of ordered) {
		const assets: {asset: AssetId; fit?: PoseFit}[] = [];

		for (const [step, image] of item.images.entries()) {
			const suffix = item.images.length > 1 ? `-${step + 1}` : '';
			const type = image.blob.type || 'image/png';
			const extension = type.split('/')[1] ?? 'png';

			try {
				const result = await store.putAsset(
					new File([image.blob], `${name}${suffix}.${extension}`, {type}),
					{
						kind: 'frame',
						name: `${character.id}-${name}${suffix}`,
						ownerCharacter: character.id
					}
				);

				assets.push({asset: result.id, fit: image.fit});
			} catch (error) {
				console.error(`Could not import ${image.label} into pose ${name}`, error);
			}
		}

		if (assets.length === 0) {
			continue;
		}

		const pose: CharacterPose = {anchors: newPoseAnchors({poses})};

		if (assets.length === 1) {
			pose.asset = assets[0].asset;

			if (assets[0].fit) {
				pose.fit = assets[0].fit;
			}
		} else {
			pose.steps = assets.map(({asset, fit}) => {
				const step: PoseStep = {asset};

				if (item.dur !== undefined) {
					step.dur = item.dur;
				}

				if (fit) {
					step.fit = fit;
				}

				return step;
			});

			if (item.loop === false) {
				pose.loop = false;
			}
		}

		poses[name] = pose;
	}

	return poses;
}

/**
 * Uploads files as images for one pose's steps and returns their ids, in order. The step
 * strip appends them.
 */
export async function stepImagesFromFiles(
	store: AssetStore,
	character: Pick<Character, 'id'>,
	poseName: string,
	files: File[]
): Promise<AssetId[]> {
	const ids: AssetId[] = [];

	for (const file of files) {
		try {
			const result = await store.putAsset(file, {
				kind: 'frame',
				name: `${character.id}-${poseName}`,
				ownerCharacter: character.id
			});

			ids.push(result.id);
		} catch (error) {
			console.error(`Could not add ${file.name} as a step`, error);
		}
	}

	return ids;
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
