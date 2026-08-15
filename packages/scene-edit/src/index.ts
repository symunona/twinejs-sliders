/**
 * @sliders/scene-edit — text edits for the visual editor (spec 07, spec 10 phase 0).
 *
 * The text is the source of truth. There is no scene model that YAML is generated from;
 * a drag produces a `TextEdit`, the editor applies it to the CodeMirror document, and the
 * preview re-parses. That is the only arrangement where hand-edited and dragged YAML
 * cannot silently disagree.
 *
 * EDITOR ONLY. Nothing here may be imported by scene-core, render-dom or the story format
 * — the format bundles `packages/scene-*`, and a runtime has no business rewriting text.
 */

export {formatAt, formatNumber, formatValue} from './format';
export {removeSceneKey, setSceneKey} from './scene-key';
export {entityAtLine, entityLines} from './select';
export {
	addEntity,
	mergeEdits,
	removeEntities,
	removeEntity,
	removeEntityKey,
	setEntityKey
} from './write';
export type {EntityTarget, LineSpan, TextEdit} from './types';

/** Apply an edit. Here so tests and callers cannot disagree about what an edit means. */
export function applyEdit(
	text: string,
	edit: {from: number; to: number; insert: string}
): string {
	return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}
