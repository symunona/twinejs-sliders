/**
 * @sliders/scene-core — headless scene semantics.
 *
 * Merge a scene onto a base stage, run its beats into a state sequence, diff two stages
 * into transitions. No DOM, no assets, no renderer.
 */

export {applyScene} from './apply-scene';
export {DEFAULT_DURATIONS, diffStages} from './diff-stages';
export type {Placement} from './diff-stages';
export {collectMarks, runBeats} from './run-beats';
export {
	CAMERA_DEFAULT,
	ENTITY_DEFAULTS,
	cloneStage,
	materialize,
	mergePatch,
	resolveZ,
	upsertFx
} from './stage';
