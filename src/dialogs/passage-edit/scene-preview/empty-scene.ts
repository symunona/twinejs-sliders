/**
 * Scene ▸ Insert Empty Scene, the editor's half.
 *
 * The format's command writes a bare `[scene]` … `[continued]` (it cannot see the
 * library). The passage editor intercepts it and writes the same block with a `bg:`, so
 * the scene editor it then opens has a stage to show. The backdrop, in order:
 *
 * 1. the last one the author used in THIS story: the last-scene handoff when it was
 *    written in this story, else the last scene passage (story order) that has one;
 * 2. the first `bg` asset the story sees (own collection, then attached, in order);
 * 3. the first `bg` asset in any shared pack -- which then gets attached;
 * 4. the `DEMO` pack's placeholder, the pack and the picture created when missing.
 */

import {extractSceneBlock} from '@sliders/scene-index';
import {parseScene} from '@sliders/scene-schema';
import type {AssetRecord, LibraryEngine} from '@sliders/asset-library';
import {matchPassageName, poseAssets} from '@sliders/scene-types';
import {attachCollections} from '../../../store/asset-library/auto-attach';
import {storyView} from '../../../store/asset-library/story-asset-store';
import {readLastScene} from './use-last-scene';

/** The format's command name. `format/src/twine-extensions/sliders/scene-commands.ts`. */
export const EMPTY_SCENE_COMMAND = 'insertEmptyScene';

/**
 * Is this toolbar command Insert Empty Scene? Twine registers a format's CodeMirror
 * commands namespaced by format and version (`sliders-0.2.0insertEmptyScene`), so the
 * name only ends with the format's own.
 */
export function isEmptySceneCommand(name: string): boolean {
	return name.endsWith(EMPTY_SCENE_COMMAND);
}

export const DEMO_PACK_NAME = 'DEMO';
export const DEMO_BG_NAME = 'demo-bg';

/** The block. Same shape as the format's `EMPTY_SCENE`, plus the backdrop. */
export function emptySceneText(bg?: string): string {
	return `\n[scene]\n${bg ? `bg: ${bg}\n` : ''}\n\n[continued]\n`;
}

function sceneBg(text: string): string | undefined {
	try {
		const bg = parseScene(text).scene.bg;

		return typeof bg === 'string' && bg.trim() ? bg.trim() : undefined;
	} catch (error) {
		return undefined;
	}
}

/** Step 1: the last backdrop this story's scenes use. */
export function lastUsedBg(
	passages: {name: string; text: string}[]
): string | undefined {
	const record = readLastScene();

	if (
		record?.passageName &&
		matchPassageName(
			passages.map(passage => passage.name),
			record.passageName
		) !== undefined
	) {
		const bg =
			typeof record.text === 'string' ? sceneBg(record.text) : undefined;

		if (bg) {
			return bg;
		}
	}

	for (let i = passages.length - 1; i >= 0; i--) {
		const block = extractSceneBlock(passages[i].text);
		const bg = block ? sceneBg(block.text) : undefined;

		if (bg) {
			return bg;
		}
	}

	return undefined;
}

function isBg(asset: AssetRecord, poseImages: Set<string>): boolean {
	return !asset.deleted && asset.kind === 'bg' && !poseImages.has(asset.id);
}

/** Every asset id some character uses as a pose image. Not a backdrop. */
function poseImageIds(engine: LibraryEngine): Set<string> {
	const ids = new Set<string>();

	for (const character of engine.characters()) {
		for (const pose of Object.values(character.poses ?? {})) {
			poseAssets(pose).forEach(id => ids.add(id));
		}
	}

	return ids;
}

/**
 * The name to write for an asset found outside the story's view, once its collection is
 * attached: plain, unless that name resolves to something else first.
 */
function nameFor(
	engine: LibraryEngine,
	storyId: string,
	asset: AssetRecord
): string {
	if (engine.resolver(storyId).asset(asset.name)?.id === asset.id) {
		return asset.name;
	}

	const collection = engine.get(asset.collection, 'collection');

	return collection ? `${collection.name}/${asset.name}` : asset.name;
}

/** A 1280×720 placeholder backdrop. Canvas when there is one, else a 1×1 grey PNG. */
export async function demoBgPng(): Promise<Uint8Array> {
	try {
		const canvas = document.createElement('canvas');

		canvas.width = 1280;
		canvas.height = 720;

		const context = canvas.getContext('2d');

		if (context) {
			const gradient = context.createLinearGradient(0, 0, 0, 720);

			gradient.addColorStop(0, '#5b6f8f');
			gradient.addColorStop(0.62, '#c9a98a');
			gradient.addColorStop(0.62, '#6d5a48');
			gradient.addColorStop(1, '#3b3027');
			context.fillStyle = gradient;
			context.fillRect(0, 0, 1280, 720);
			context.fillStyle = 'rgba(255, 255, 255, 0.5)';
			context.font = 'bold 96px sans-serif';
			context.textAlign = 'center';
			context.fillText(DEMO_PACK_NAME, 640, 300);
		}

		const blob = await new Promise<Blob | null>(resolve =>
			canvas.toBlob(resolve, 'image/png')
		);

		if (blob && blob.size > 0) {
			return new Uint8Array(await blob.arrayBuffer());
		}
	} catch (error) {
		// No canvas (tests, locked-down browser). The 1×1 below is still a picture.
	}

	return Uint8Array.from(
		atob(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8fPj4fwAJLAO9cP7/hQAAAABJRU5ErkJggg=='
		),
		char => char.charCodeAt(0)
	);
}

/** Step 4: the DEMO pack's first backdrop, creating the pack or the picture as needed. */
export async function demoBg(
	engine: LibraryEngine,
	makePng: () => Promise<Uint8Array> = demoBgPng
): Promise<AssetRecord> {
	const poseImages = poseImageIds(engine);
	let pack = engine.collectionByName(DEMO_PACK_NAME);

	if (pack?.deleted) {
		pack = undefined;
	}

	if (!pack) {
		pack = engine.createCollection({
			description: 'Placeholder art, made by Insert Empty Scene.',
			kind: 'shared',
			name: DEMO_PACK_NAME
		});
	}

	const existing = engine
		.assets(pack.id)
		.find(asset => isBg(asset, poseImages));

	if (existing) {
		return existing;
	}

	const bytes = await makePng();
	const result = await engine.addAsset(bytes, 'image/png', {
		allowDuplicate: true,
		collection: pack.id,
		kind: 'bg',
		name: DEMO_BG_NAME,
		tags: []
	});

	if (!result.asset) {
		throw new Error('Could not create the DEMO backdrop');
	}

	return result.asset;
}

/**
 * The `bg:` an empty scene gets (steps 1-4), attaching whatever pack it came from.
 * Undefined only when the library itself failed: an empty scene with no backdrop is still
 * a scene.
 */
export async function defaultSceneBg(
	engine: LibraryEngine,
	story: {id: string; name: string; passages: {name: string; text: string}[]},
	makePng?: () => Promise<Uint8Array>
): Promise<string | undefined> {
	const last = lastUsedBg(story.passages);

	if (last) {
		return last;
	}

	const poseImages = poseImageIds(engine);
	const inView = storyView(engine, story.id).assets.find(asset =>
		isBg(asset, poseImages)
	);

	if (inView) {
		return inView.name;
	}

	const shared = new Set(
		engine
			.collections()
			.filter(collection => !collection.deleted && collection.kind === 'shared')
			.map(collection => collection.id)
	);
	const found =
		engine
			.assets()
			.find(asset => shared.has(asset.collection) && isBg(asset, poseImages)) ??
		(await demoBg(engine, makePng));

	attachCollections(engine, story.id, [found.collection], story.name);

	return nameFor(engine, story.id, found);
}
