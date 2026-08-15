/**
 * Selection, in both directions (spec 07, "Selection").
 *
 * Click a sprite and the caret lands on its line; put the caret on its line and the sprite
 * lights up. Both directions run off `entityAtLine` / `entityLines`, which read the same
 * YAML node ranges the writers do, so "where mira is" can never mean two different things.
 *
 * ⚠️ Three line numberings meet here and only one of them is 0-based:
 *
 *   scene-edit  1-indexed, relative to the BLOCK
 *   block       `SceneBlock.lineOffset` is the 0-based passage line the block starts on
 *   CodeMirror  0-indexed, relative to the PASSAGE
 *
 * Off by one and the caret lands on the neighbouring entity, which looks like the feature
 * working until the author notices it is editing the wrong character. `blockLineToEditorLine`
 * and `editorLineToBlockLine` are exported so a test can pin the conversion.
 */

import * as React from 'react';
import {entityAtLine, entityLines} from '@sliders/scene-edit';
import type {EntityTarget} from '@sliders/scene-edit';
import type {SceneBlock} from '@sliders/scene-index';
import type {Beat, EntityId, Scene} from '@sliders/scene-types';

/** CSS classes the marks carry. Styled in `scene-preview.css`. */
export const ENTRY_MARK_CLASS = 'sliders-selected-entity';
export const BEAT_MARK_CLASS = 'sliders-selected-beat';

type BlockLike = Pick<SceneBlock, 'lineOffset' | 'text'>;

/** A 1-indexed line inside the block -> the 0-indexed CodeMirror line. */
export function blockLineToEditorLine(
	block: Pick<SceneBlock, 'lineOffset'>,
	blockLine: number
): number {
	return block.lineOffset + blockLine - 1;
}

/** The 0-indexed CodeMirror line -> a 1-indexed line inside the block. */
export function editorLineToBlockLine(
	block: Pick<SceneBlock, 'lineOffset'>,
	editorLine: number
): number {
	return editorLine - block.lineOffset + 1;
}

/** Which entity, if any, the caret is sitting in. */
export function entityAtEditorLine(
	block: BlockLike | undefined,
	editorLine: number
): EntityTarget | undefined {
	if (!block) {
		return undefined;
	}

	const line = editorLineToBlockLine(block, editorLine);

	// Outside the block entirely — the caret is in prose above or below the scene.
	if (line < 1) {
		return undefined;
	}

	return entityAtLine(block.text, line);
}

/** Who a beat is about, or undefined for `wait` / `fx` / `mark` / `box`. */
function beatSpeaker(beat: Beat): EntityId | undefined {
	return beat.kind === 'say' || beat.kind === 'set' ? beat.who : undefined;
}

export interface EditorLineSpan {
	start: number;
	end: number;
}

/**
 * Every CodeMirror line range that mentions an entity: its `cast:` / `props:` entry first,
 * then each beat that speaks for it.
 *
 * Highlighting the beat lines IS the connection between the stage and the timeline — beats
 * are never editable visually (spec 07), so showing which ones an entity appears in is the
 * whole of what the selection owes the text.
 */
export function entityHighlights(
	block: BlockLike | undefined,
	scene: Scene | undefined,
	id: EntityId,
	kind: EntityTarget['kind']
): {entry?: EditorLineSpan; beats: EditorLineSpan[]} {
	const beats: EditorLineSpan[] = [];

	if (!block) {
		return {beats};
	}

	const toEditor = (span: {start: number; end: number}) => ({
		end: blockLineToEditorLine(block, span.end),
		start: blockLineToEditorLine(block, span.start)
	});

	const entry = entityLines(block.text, {id, kind});

	// Only the beats that name this entity are looked up: `entityLines` re-parses the block
	// on every call, and a scene with forty beats would parse it forty times per click.
	(scene?.beats ?? []).forEach((beat, index) => {
		if (beatSpeaker(beat) !== id) {
			return;
		}

		const span = entityLines(block.text, {beat: index, id, kind});

		if (span) {
			beats.push(toEditor(span));
		}
	});

	return {beats, entry: entry ? toEditor(entry) : undefined};
}

export interface StageSelectionOptions {
	block?: BlockLike;
	editor?: CodeMirror.Editor;
	/** Entity ids currently on stage. The selection is pruned to these. */
	stageIds: EntityId[];
	scene?: Scene;
	/** Kind per entity id, so a selection can be written back without the stage. */
	kindOf: (id: EntityId) => EntityTarget['kind'];
	/** False while the preview is collapsed: no marks, no caret chasing. */
	enabled: boolean;
}

export interface StageSelection {
	selection: EntityId[];
	/** Select from the stage. Moves the caret to the primary entity's line. */
	select: (ids: EntityId[]) => void;
	clear: () => void;
}

export function useStageSelection(
	options: StageSelectionOptions
): StageSelection {
	const {block, editor, enabled, kindOf, scene, stageIds} = options;
	const [selection, setSelection] = React.useState<EntityId[]>([]);

	// Everything the two effects below need, without either of them re-running when it
	// changes: the marks must not be torn down and rebuilt on every keystroke.
	const latest = React.useRef({block, enabled, kindOf, scene, selection});

	latest.current = {block, enabled, kindOf, scene, selection};

	/**
	 * The caret line we just moved to ourselves.
	 *
	 * Clicking a sprite sets the caret, which fires `cursorActivity`, which would set the
	 * selection again — and for a multi-select that echo would collapse it to the one
	 * entity the caret landed on. Remembering the line rather than setting a flag survives
	 * CodeMirror delivering the event at the end of an enclosing operation.
	 */
	const caretEcho = React.useRef<number>();

	const select = React.useCallback(
		(ids: EntityId[]) => {
			setSelection(current =>
				current.length === ids.length &&
				current.every((id, index) => id === ids[index])
					? current
					: ids
			);

			const {block: currentBlock, kindOf: currentKind} = latest.current;
			const primary = ids[0];

			if (!editor || !currentBlock || primary === undefined) {
				return;
			}

			const span = entityLines(currentBlock.text, {
				id: primary,
				kind: currentKind(primary)
			});

			if (!span) {
				return;
			}

			const line = blockLineToEditorLine(currentBlock, span.start);

			caretEcho.current = line;
			// `setCursor` deliberately does not focus: the stage keeps the keyboard so the
			// arrow keys nudge instead of moving the caret.
			editor.setCursor({ch: 0, line});
		},
		[editor]
	);

	const clear = React.useCallback(() => setSelection([]), []);

	// Caret -> selection.
	React.useEffect(() => {
		if (!editor) {
			return;
		}

		const handler = () => {
			const {
				block: currentBlock,
				enabled: on,
				selection: current
			} = latest.current;
			const line = editor.getCursor().line;

			if (caretEcho.current === line) {
				caretEcho.current = undefined;
				return;
			}

			caretEcho.current = undefined;

			if (!on) {
				return;
			}

			const target = entityAtEditorLine(currentBlock, line);

			// Caret in prose, in `bg:`, between beats: leave the selection alone rather
			// than clearing it, so typing next to a selected sprite does not drop it.
			if (!target) {
				return;
			}

			if (current.length === 1 && current[0] === target.id) {
				return;
			}

			setSelection([target.id]);
		};

		editor.on('cursorActivity', handler);

		return () => editor.off('cursorActivity', handler);
	}, [editor]);

	// Selection -> marked lines.
	React.useEffect(() => {
		if (!editor || !enabled || selection.length === 0 || !block) {
			return;
		}

		const marks: CodeMirror.TextMarker[] = [];
		const doc = editor.getDoc();

		const mark = (span: EditorLineSpan, className: string) => {
			const last = Math.min(span.end, doc.lastLine());
			const start = Math.max(0, span.start);

			if (start > last) {
				return;
			}

			marks.push(
				doc.markText(
					{ch: 0, line: start},
					{ch: doc.getLine(last)?.length ?? 0, line: last},
					{className}
				)
			);
		};

		for (const id of selection) {
			const {beats, entry} = entityHighlights(block, scene, id, kindOf(id));

			if (entry) {
				mark(entry, ENTRY_MARK_CLASS);
			}

			for (const span of beats) {
				mark(span, BEAT_MARK_CLASS);
			}
		}

		return () => marks.forEach(existing => existing.clear());
		// `kindOf` is a lookup into the stage and changes identity constantly; the marks
		// only need to be rebuilt when the text, the parse or the selection moves.
		// eslint-disable-next-line
	}, [block, editor, enabled, scene, selection]);

	// An entity the author deleted out of the text cannot stay selected.
	React.useEffect(() => {
		setSelection(current => {
			const kept = current.filter(id => stageIds.includes(id));

			return kept.length === current.length ? current : kept;
		});
	}, [stageIds]);

	return React.useMemo(
		() => ({clear, select, selection}),
		[clear, select, selection]
	);
}
