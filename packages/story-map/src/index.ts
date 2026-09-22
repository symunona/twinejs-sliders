/**
 * @sliders/story-map — read a story without a disk under it.
 *
 * The map, the linter and the per-scene asset walk, all pure over `(story, manifest)`.
 * `twine-cli` had these bound to a `Source`; the voice panel needs the same answers in a
 * browser, and two implementations of "what does this story look like" is two answers.
 *
 * Nothing here imports node. Nothing here imports the DOM.
 */

export {
	catalogFromManifest,
	catalogRows,
	referencedAssetIds,
	resolveSceneAssets,
	unusedAssets
} from './assets';
export type {
	AssetCatalog,
	AssetPresence,
	AssetRow,
	ResolveOptions,
	SceneLookup
} from './assets';
export {
	buildLinkGraph,
	formatFinding,
	hasErrors,
	lintPassageText,
	lintStory,
	passageExits,
	sortFindings
} from './lint';
export type {
	LintFinding,
	PassageExit,
	PassageLintOptions,
	StoryLintInput
} from './lint';
export {
	bytesLabel,
	buildStoryMap,
	linksOf,
	renderStoryMap,
	tokenEstimate
} from './map';
export type {
	BuildStoryMapInput,
	MapAssets,
	MapPassage,
	MapScene,
	RenderStoryMapOptions,
	StoryMap
} from './map';
export type {AssetMetaRow, Manifest, PassageLike, StoryLike} from './types';
