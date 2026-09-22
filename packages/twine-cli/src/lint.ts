/**
 * The linter now lives in `@sliders/story-map` — it is pure, and the editor lints too.
 * This file is the CLI's name for it, kept so every `../lint` import in `cmd/` still reads
 * like the thing it does.
 */

export {
	buildLinkGraph,
	formatFinding,
	hasErrors,
	lintPassageText,
	lintStory,
	passageExits,
	sortFindings
} from '@sliders/story-map';
export type {
	LintFinding,
	PassageExit,
	PassageLintOptions,
	StoryLintInput
} from '@sliders/story-map';
