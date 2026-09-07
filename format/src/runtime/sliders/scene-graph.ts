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
import type {SceneIndex} from '@sliders/scene-index';
import {emptyStage} from '@sliders/scene-types';
import type {Stage} from '@sliders/scene-types';
import {createLoggers} from '../logger';
import {passages} from '../story';

const {warn} = createLoggers('scene');

let index: SceneIndex | undefined;

export function initSceneIndex(): void {
	index = buildSceneIndex(
		passages().map(passage => ({
			name: passage.name ?? '(unnamed passage)',
			text: passage.source
		}))
	);

	for (const error of index.errors) {
		warn(
			`[scene] line ${error.line}: ${error.message}${
				error.hint ? ` ${error.hint}` : ''
			}`
		);
	}
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
