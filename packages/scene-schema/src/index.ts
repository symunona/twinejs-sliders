/**
 * @sliders/scene-schema — the one parser.
 *
 * Used by the story format runtime, the CM5 mode, the fork's editor lint, the preview and
 * the visual editor. One source of truth or everything drifts (spec 05).
 */

export {
	BEAT_BODY_KEYS,
	BEAT_COMMAND_KEYS,
	BG_KEYS,
	BOX_KEYS,
	CAMERA_KEYS,
	ENTITY_KEYS,
	LINK_ENTITY_KEYS,
	LINK_KEYS,
	LINK_LIST_KEYS,
	RETIRED_EASE_KINDS,
	RETIRED_ENTITY_KEYS,
	SAY_KEYS,
	SCENE_STEP_KEYS,
	TOP_LEVEL_KEYS,
	emptyScene,
	parseScene
} from './parse-scene';
export {sceneRefSpans} from './asset-refs';
export type {SceneRefKind, SceneRefSpan} from './asset-refs';
export {
	parsePassageReferences,
	scanLinkTargets,
	sceneEntityLinkSpans,
	sceneEntityLinkTargets,
	sceneLinkTargetSpans,
	sceneLinkTargets
} from './references';
export type {SceneEntityLinkSpan, SceneLinkSpan} from './references';
export {
	STORY_BUBBLE_KEYS,
	STORY_BUBBLE_PREFIX,
	storyBubbleStyle,
	storyBubbleVar
} from './story-bubble';
export type {StoryBubbleKey} from './story-bubble';
export {beatsOfferLinks} from './beat-links';
export {scanWikiLinks} from './links';
export type {WikiLink} from './links';
export {keyFix, keyHint, levenshtein, nearestKey} from './levenshtein';
export {
	VARS_LINE_RE,
	VARS_NEAR_MISS_RE,
	VARS_SEPARATOR,
	VARS_SEPARATOR_RE,
	VARS_SEPARATOR_SPLIT_RE,
	isVarsSeparator,
	looksLikeVarsLine,
	looksLikeVarsSection,
	nearMissSeparator,
	scanVarsLines,
	splitVarsSection,
	splitVarsSectionAt,
	varsConditionError,
	varsConditionSource,
	varsLineName,
	varsValueError,
	varsValueErrors,
	varsValueSource
} from './vars-section';
export type {
	NearMissSeparator,
	SplitVarsSection,
	VarsDeclaration,
	VarsIgnoredLine,
	VarsScan
} from './vars-section';
