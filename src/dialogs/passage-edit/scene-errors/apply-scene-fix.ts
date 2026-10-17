import type {SceneFix} from '@sliders/scene-types';
import {FIX_ORIGIN} from '../scene-preview/use-scene-writer';

/**
 * Applies the mechanical repair an error carries. True when it landed.
 *
 * One `replaceRange`, so the fix is one undo entry, and guarded on the text still being
 * what the parse saw: `parse` is debounced, so between the error being computed and the
 * button being clicked the author may have typed over the very span it points at.
 * Refusing is the whole point of `fix.replaces` — a fix that splices its suggestion over
 * something else is worse than no button.
 *
 * Shared by the error list under the passage text and the stage's error sidebar, so the
 * two can never disagree on what "Fix" does.
 */
export function applySceneFix(
	doc: Pick<CodeMirror.Doc, 'getRange' | 'replaceRange'>,
	fix: SceneFix
): boolean {
	const from = {ch: fix.col - 1, line: fix.line - 1};
	const to = {
		ch: fix.endCol === undefined ? fix.col - 1 : fix.endCol - 1,
		line: (fix.endLine ?? fix.line) - 1
	};

	if (doc.getRange(from, to) !== fix.replaces) {
		return false;
	}

	doc.replaceRange(fix.text, from, to, FIX_ORIGIN);
	return true;
}
