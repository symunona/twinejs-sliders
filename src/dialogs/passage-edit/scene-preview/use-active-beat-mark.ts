/**
 * The beat the preview is standing on, lit up in the passage text.
 *
 * The same idea as a debugger's current-statement highlight: the stage shows a moment,
 * and this says which lines produced it. A scene's beats all look alike in the source —
 * ten `- mira:` lines in a row — so without it the scrubber and the text are two views
 * with no visible connection.
 *
 * Line handles rather than numbers, like the error marks: the document can lose lines
 * between a parse and the cleanup, and a number would then unclass the wrong line.
 */

import {Editor, LineHandle} from 'codemirror';
import * as React from 'react';
import type {SceneSpan} from '@sliders/scene-types';

const LINE_CLASS = 'sliders-active-beat';

/**
 * The passage lines a span covers, 0-indexed.
 *
 * A YAML node's range ends at the start of whatever follows it, so a beat written as its
 * own line reports an `endLine` one further down. Ending at column 1 is the tell, and
 * dropping that line is what keeps the highlight off the next beat.
 */
export function beatLines(
	span: SceneSpan,
	lineOffset: number,
	lineCount: number
): number[] {
	const first = span.line - 1 + lineOffset;
	let last = (span.endLine ?? span.line) - 1 + lineOffset;

	if (last > first && span.endCol === 1) {
		last--;
	}

	const lines: number[] = [];

	for (let line = Math.max(0, first); line <= Math.min(last, lineCount - 1); line++) {
		lines.push(line);
	}

	return lines;
}

export function useActiveBeatMark(
	editor: Editor | undefined,
	span: SceneSpan | undefined,
	lineOffset: number
): void {
	React.useEffect(() => {
		if (!editor || !span) {
			return;
		}

		const marked: LineHandle[] = [];

		for (const line of beatLines(span, lineOffset, editor.lineCount())) {
			marked.push(editor.addLineClass(line, 'background', LINE_CLASS));
		}

		return () => {
			for (const line of marked) {
				editor.removeLineClass(line, 'background', LINE_CLASS);
			}
		};
	}, [editor, lineOffset, span]);
}

/**
 * Which beat a passage line sits inside, or undefined for a line outside every beat.
 *
 * The inverse of `beatLines`, over the same spans — `beatSpans` is already on the parse the
 * preview is holding, so this costs nothing, and unlike `entityAtLine` it answers for a
 * command beat (`- wait: 0.5`) too, which names no entity but is still a beat the scrubber
 * can stand on.
 *
 * Index into `scene.beats`. The scrubber position is one more than that, because state N is
 * produced by beat N - 1.
 */
export function beatAtLine(
	spans: SceneSpan[] | undefined,
	line: number,
	lineOffset: number,
	lineCount: number
): number | undefined {
	if (!spans) {
		return undefined;
	}

	for (let index = 0; index < spans.length; index++) {
		if (beatLines(spans[index], lineOffset, lineCount).includes(line)) {
			return index;
		}
	}

	return undefined;
}
