/**
 * "Test from here" still has to know what the STORY looks like.
 *
 * Story-wide Sliders settings — `sliders.bubble.*`, `sliders.autoAdvance`,
 * `sliders.fullScreen`, `sliders.showLinks`, `sliders.mute` — are ordinary state
 * variables, and the editor's story-defaults dialog writes them into the vars section of
 * the story's START passage because that is the one passage every normal play renders
 * first. Chapbook sets a passage's vars only when that passage RENDERS
 * (`template/render-parsed.ts`), so the arrangement works exactly as long as the reader
 * enters through the front door.
 *
 * Test-from-here does not. It publishes the story with `startnode=` pointing at the
 * passage under test, so the real start passage is never rendered, its vars are never set,
 * and `storyBubbleDefaults()` returns undefined — the widest of the four bubble layers in
 * `stage-element.ts` is silently empty and the scene is drawn in the format's own defaults
 * instead of the story's. Test mode cannot even inherit them from a previous play:
 * `config.testing` makes `runtime/index.ts` skip `restoreFromStorage()` altogether.
 *
 * So the editor tells us where the front door actually is. `src/util/publish.ts` writes
 * `data-sliders-story-start="<pid>"` on `<tw-storydata>` — the real start passage's 1-based
 * local pid, the same numbering `tw-passagedata` uses — and only when it differs from
 * `startnode=`. A normal play has no attribute and this module does nothing.
 *
 * VARS ONLY. The body is not rendered and the trail is not touched: the author asked to
 * start in the middle of the story, not to play its opening beat first. Evaluating the
 * vars through `renderParsed` with an empty block list rather than looping over
 * `parsed.vars` here is deliberate — conditional vars (`name (condition): value`) and the
 * `value()`/`condition()` calling convention then exist in exactly one place and cannot
 * drift, which is the mistake this repo has already paid for twice with the vars separator
 * and the vars line grammar.
 *
 * Lives in `sliders/` rather than `story/`: `story/` is vendored Chapbook, and every file
 * added there widens the fork that `format/README.md` exists to keep thin. Nothing here is
 * Chapbook's problem — the attribute, the reason and the settings are all Sliders'. The
 * one Chapbook edit is the call site in `runtime/index.ts`, which is in the README table.
 *
 * Not one-shot, unlike `start-beat.ts`: there is nothing to spend. `restart()` reloads the
 * window, so init runs again from scratch and the story's defaults are re-applied, which
 * is what a restart should do.
 */

import {createLoggers} from '../logger';
import {passageWithId} from '../story';
import {parse} from '../template/parse';
import {renderParsed} from '../template/render-parsed';

const ATTRIBUTE = 'data-sliders-story-start';

const {log, warn} = createLoggers('sliders-story-start');

/**
 * Set the story's own vars from its real start passage, when this publish says the story
 * was launched somewhere else.
 *
 * Must run after `initState()` and `initTemplate()` and BEFORE `initStory()`: `initStory()`
 * defaults `trail`, and the `state-change` for `trail` is what `display/events.ts` turns
 * into the first render. Anything set after that point arrives too late for the first
 * scene, which is the only scene test-from-here is about.
 *
 * `set()` writes to state's `vars`, `setDefaults()` to its `defaults`, and `get()` prefers
 * `vars` — so `initSliders()` running its `slidersDefaults` afterwards cannot clobber
 * anything the start passage stated here.
 *
 * Every way of being absent or wrong is a no-op: no attribute, a pid that is not a number,
 * a pid naming no passage, a passage with no vars section.
 */
export function applyStoryStartVars(): void {
	const raw = document.querySelector('tw-storydata')?.getAttribute(ATTRIBUTE);

	if (raw === null || raw === undefined) {
		return;
	}

	const pid = Number.parseInt(raw, 10);

	if (!Number.isFinite(pid)) {
		warn(`The story start passage id "${raw}" is not a number. Ignoring it.`);
		return;
	}

	const passage = passageWithId(pid);

	if (!passage) {
		warn(`No passage has the id ${pid}, so its vars were not set.`);
		return;
	}

	const parsed = parse(passage.source);

	if (parsed.vars.length === 0) {
		return;
	}

	log(
		`Setting ${parsed.vars.length} story vars from the start passage "${passage.name}"`
	);

	// A vars line is author code, and a throw here would happen before `initStory()` — the
	// whole story would fail to open, where a normal play would at worst land on the error
	// screen with the rest of the passage. The start passage is not rendered in this mode,
	// so nothing else will ever report it: warn (never muted, see `logger/logger.ts`) and
	// play on with whatever was set before the bad line.
	try {
		// No blocks, so no insert and no modifier can be reached: handing in two empty
		// lists says that in the call itself, and the returned markup is thrown away.
		renderParsed({vars: parsed.vars, blocks: []}, [], []);
	} catch (error) {
		warn(
			`The vars section of the start passage "${
				passage.name
			}" could not be evaluated: ${(error as Error).message}`
		);
	}
}
