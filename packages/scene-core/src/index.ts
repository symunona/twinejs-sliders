/**
 * @sliders/scene-core — headless scene semantics.
 *
 * Merge a scene onto a base stage, run its beats into a state sequence, diff two stages
 * into transitions. No DOM, no assets, no renderer.
 */

export {applyScene} from './apply-scene';
export {
	DEFAULT_DURATIONS,
	diffStages,
	easeTransitions,
	timeTransitions
} from './diff-stages';
export type {Placement} from './diff-stages';
export {collectMarks, runBeats} from './run-beats';
export {parentOffsets, resolveStage, worldPositions} from './resolve-stage';
export {
	CAMERA_DEFAULT,
	ENTITY_DEFAULTS,
	cloneStage,
	materialize,
	mergePatch,
	resolveZ,
	upsertFx
} from './stage';
export {
	IDLE_POSE,
	WALK_NUDGE,
	WALK_POSE,
	WALK_STAGE_ASPECT,
	clipRingToUnit,
	compileWalk,
	defaultWalkDepth,
	depthScale,
	findWalkPath,
	hasWalkArea,
	idlePoseName,
	imageToStage,
	isWalkable,
	pointInRing,
	remapWalkArea,
	snapToWalk,
	stageToImage,
	walkPathLength
} from './walk-path';
export type {
	CompileWalkOptions,
	CompiledWalk,
	ImageSize,
	WalkPath
} from './walk-path';
