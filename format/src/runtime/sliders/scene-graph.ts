/**
 * The cross-passage tier: `from:` inheritance reaches across passages, so somebody has to
 * read all of them at once. `@sliders/scene-index` does the work; this is the bridge from
 * Chapbook's story data to it.
 *
 * Built once at startup rather than per render. Scenes are static text — nothing a story
 * does at runtime can change them — and rebuilding per passage would re-parse the whole
 * story on every navigation.
 */

import {buildSceneIndex} from '@sliders/scene-index';
import type {SceneIndex, SceneIndexError} from '@sliders/scene-index';
import {emptyStage} from '@sliders/scene-types';
import type {Scene, Stage} from '@sliders/scene-types';
import {passages} from '../story';

let index: SceneIndex | undefined;

/**
 * Index codes that only exist BETWEEN passages. A scene's own parse errors are reported by
 * `scene-modifier.ts` when it renders, so the index repeating them would say each twice.
 */
const CROSS_PASSAGE_CODES = new Set(['from-cycle', 'unknown-from']);

/**
 * Builds the index. Reports NOTHING to the warning list.
 *
 * It used to warn every error in the story here, at startup — so "Test from here" on one
 * scene opened under a banner of every other scene's typos, none of them about the scene
 * under test. The editor already lints each scene as it is written; the player reports a
 * scene's problems when THAT scene plays (`crossPassageProblems`, plus the modifier's own
 * parse errors). The story-wide count goes to `console.info`, which `<warning-list>` and
 * the test bar do not spy on.
 */
export function initSceneIndex(): void {
	index = buildSceneIndex(
		passages().map(passage => ({
			name: passage.name ?? '(unnamed passage)',
			text: passage.source
		}))
	);

	if (index.errors.length > 0) {
		// eslint-disable-next-line no-console
		console.info(
			`scene: ${index.errors.length} scene problem(s) in this story. Each is reported when its passage plays.`
		);
	}
}

function describeIndexError(error: SceneIndexError): string {
	return `[scene] line ${error.line}: ${error.message}${
		error.hint ? ` ${error.hint}` : ''
	}`;
}

/** The cross-passage problems (`from:` cycles, unknown `from:`) of one passage's scene. */
export function crossPassageProblems(passage: string): string[] {
	return (index?.errors ?? [])
		.filter(
			error => error.passage === passage && CROSS_PASSAGE_CODES.has(error.code)
		)
		.map(describeIndexError);
}

/**
 * The stage a scene's `from:` names. An unknown reference is not an error here — the index
 * has already reported it — so this hands back an empty stage and lets the scene draw.
 */
export function stageFrom(ref: string | undefined): Stage {
	if (!ref) {
		return emptyStage();
	}

	return index?.resolve(ref) ?? emptyStage();
}

/** A passage's scene as authored, before `from:` — what the preload plan walks. */
export function sceneOf(passage: string): Scene | undefined {
	return index?.scenes.get(passage)?.scene;
}
