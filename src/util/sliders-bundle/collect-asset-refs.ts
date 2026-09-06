/**
 * Every asset-ish name a story writes in its `[scene]` blocks.
 *
 * Deliberately a per-passage scan, NOT a `buildSceneIndex()` walk: `from:` inheritance can
 * only carry forward names that some passage already spells out literally, so resolving the
 * DAG would find nothing new while dragging in cycle and unknown-`from` failure modes. A
 * half-written passage still has to contribute the refs it does have, so parse errors are
 * ignored throughout — `parseScene` always returns a best-effort scene (spec 05).
 */

import {sceneBg} from '@sliders/scene-core';
import {extractSceneBlock} from '@sliders/scene-index';
import {parseScene} from '@sliders/scene-schema';
import type {Scene} from '@sliders/scene-types';
import type {SceneAssetRefs} from './bundle.types';
import type {Story} from '../../store/stories';

/** `SceneAssetRefs` while it is still being filled — sorting happens once, at the end. */
interface RefSets {
	assetRefs: Set<string>;
	autoRefs: Set<string>;
	characterRefs: Set<string>;
	fxRefs: Set<string>;
	frameRefs: Map<string, Set<string>>;
	optionalAssetRefs: Set<string>;
}

function emptyRefSets(): RefSets {
	return {
		assetRefs: new Set(),
		autoRefs: new Set(),
		characterRefs: new Set(),
		frameRefs: new Map(),
		fxRefs: new Set(),
		optionalAssetRefs: new Set()
	};
}

/** Half-typed YAML yields blank and whitespace-only names. They resolve to nothing. */
function add(into: Set<string>, value: string | null | undefined): void {
	const name = value?.trim();

	if (name) {
		into.add(name);
	}
}

function addFrame(
	sets: RefSets,
	entityId: string,
	frame: string | undefined
): void {
	const id = entityId?.trim();
	const name = frame?.trim();

	if (!id || !name) {
		return;
	}

	let frames = sets.frameRefs.get(id);

	if (!frames) {
		frames = new Set();
		sets.frameRefs.set(id, frames);
	}

	frames.add(name);
}

function addScene(sets: RefSets, scene: Scene): void {
	// `bg: ~` means "removed" under `from:`, and removal names nothing. An `id:` with no
	// `bg:` names the backdrop implicitly: bundle it if such art exists, but never report
	// it missing, because the scene never asked for it.
	add(
		scene.bg === undefined ? sets.optionalAssetRefs : sets.assetRefs,
		sceneBg(scene)
	);

	for (const [id, entity] of Object.entries(scene.entities)) {
		if (!entity) {
			continue; // A null patch is a removal too.
		}

		// `auto` is an `entities:` entry: the parser could not tell a character id from an
		// asset name, so the name goes in its own bucket and `resolveBundleRefs` tries both.
		add(
			entity.kind === 'cast'
				? sets.characterRefs
				: entity.kind === 'auto'
				? sets.autoRefs
				: sets.assetRefs,
			entity.ref
		);
		addFrame(sets, id, entity.frame);
	}

	for (const fx of scene.fx ?? []) {
		add(sets.fxRefs, fx.id);
	}

	for (const beat of scene.beats) {
		switch (beat.kind) {
			case 'fx':
				add(sets.fxRefs, beat.fx.id);
				break;

			case 'say':
			case 'set':
				// A beat can name a frame for an entity the block never declared — that is
				// still a frame the character has to have.
				addFrame(sets, beat.who, beat.patch?.frame);
				break;
		}
	}
}

function addPassage(sets: RefSets, passageText: string): void {
	const block = extractSceneBlock(passageText);

	if (!block) {
		return;
	}

	addScene(sets, parseScene(block.text).scene);
}

function freeze(sets: RefSets): SceneAssetRefs {
	const frameRefs: Record<string, string[]> = {};

	for (const [id, frames] of sets.frameRefs) {
		frameRefs[id] = [...frames].sort();
	}

	return {
		assetRefs: [...sets.assetRefs].sort(),
		autoRefs: [...sets.autoRefs].sort(),
		characterRefs: [...sets.characterRefs].sort(),
		frameRefs,
		fxRefs: [...sets.fxRefs].sort(),
		optionalAssetRefs: [...sets.optionalAssetRefs].sort()
	};
}

/** Refs written in one passage. A passage with no `[scene]` block contributes nothing. */
export function collectPassageRefs(passageText: string): SceneAssetRefs {
	const sets = emptyRefSets();

	addPassage(sets, passageText);

	return freeze(sets);
}

/** The union of every passage's refs. */
export function collectAssetRefs(story: Story): SceneAssetRefs {
	const sets = emptyRefSets();

	for (const passage of story.passages) {
		addPassage(sets, passage.text);
	}

	return freeze(sets);
}
