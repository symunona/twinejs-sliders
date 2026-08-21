/**
 * Scene errors, drawn in the passage editor itself.
 *
 * Two marks per error: a tint on the line, so a glance finds it, and a wavy underline on
 * the exact span the parser pointed at. Hovering either one shows the message — the list
 * under the editor says the same thing, but only after the author has gone looking for it.
 *
 * Marks are torn down and rebuilt on every parse. The parse is debounced and a scene has
 * a handful of errors at most, so this stays far cheaper than trying to diff them.
 */

import {Editor, LineHandle, TextMarker} from 'codemirror';
import * as React from 'react';
import {SceneError} from '@sliders/scene-types';

/** Where the tooltip sits relative to the text it explains. */
const TOOLTIP_GAP = 6;

const MESSAGE_ATTR = 'data-sliders-error';
const HINT_ATTR = 'data-sliders-hint';

/**
 * The span to underline, clamped to the error's first line.
 *
 * A YAML node's range can cover a whole nested map, and underlining twenty lines of scene
 * to say one of them is wrong helps nobody. The line tint still covers the rest.
 */
function markRange(
	editor: Editor,
	error: SceneError
): {from: CodeMirror.Position; to: CodeMirror.Position} | undefined {
	const line = error.line - 1;

	if (line < 0 || line >= editor.lineCount()) {
		return undefined;
	}

	const text = editor.getLine(line) ?? '';
	const from = Math.max(0, Math.min(error.col - 1, text.length));
	const sameLine = error.endLine === undefined || error.endLine === error.line;
	const to =
		sameLine && error.endCol !== undefined
			? Math.max(from, Math.min(error.endCol - 1, text.length))
			: text.length;

	// An empty span marks nothing at all; take the whole line instead.
	return to > from
		? {from: {ch: from, line}, to: {ch: to, line}}
		: {from: {ch: 0, line}, to: {ch: text.length, line}};
}

function tooltipFor(target: HTMLElement): HTMLElement | undefined {
	const message = target.getAttribute(MESSAGE_ATTR);

	if (!message) {
		return undefined;
	}

	const tooltip = document.createElement('div');
	const hint = target.getAttribute(HINT_ATTR);

	tooltip.className = 'sliders-error-tooltip';
	tooltip.textContent = message;

	if (hint) {
		const hintEl = document.createElement('span');

		hintEl.className = 'hint';
		hintEl.textContent = hint;
		tooltip.appendChild(hintEl);
	}

	return tooltip;
}

export function useSceneErrorMarks(
	editor: Editor | undefined,
	errors: SceneError[]
): void {
	React.useEffect(() => {
		if (!editor) {
			return;
		}

		const marks: TextMarker[] = [];
		// Handles, not line numbers: the document can lose lines between one parse and the
		// next, and a number would then point the cleanup at the wrong line -- or at none.
		const tinted: LineHandle[] = [];

		for (const error of errors) {
			const range = markRange(editor, error);

			if (!range) {
				continue;
			}

			const severity = error.severity === 'warning' ? 'warning' : 'error';

			marks.push(
				editor.markText(range.from, range.to, {
					attributes: {
						[HINT_ATTR]: error.hint ?? '',
						[MESSAGE_ATTR]: error.message
					},
					className: `sliders-scene-${severity}`
				})
			);
			tinted.push(
				editor.addLineClass(
					range.from.line,
					'background',
					`sliders-${severity}-line`
				)
			);
		}

		// The tooltip lives on the body rather than inside the editor: CodeMirror's
		// scroller clips its own children, and an error on the last visible line would
		// have its explanation cut in half.
		const wrapper = editor.getWrapperElement();
		let tooltip: HTMLElement | undefined;

		function hide() {
			tooltip?.remove();
			tooltip = undefined;
		}

		function handleOver(event: MouseEvent) {
			const target = (event.target as HTMLElement | null)?.closest?.(
				`[${MESSAGE_ATTR}]`
			) as HTMLElement | null;

			if (!target) {
				hide();
				return;
			}

			if (tooltip?.dataset.for === target.getAttribute(MESSAGE_ATTR)) {
				return;
			}

			hide();
			tooltip = tooltipFor(target);

			if (!tooltip) {
				return;
			}

			const rect = target.getBoundingClientRect();

			tooltip.dataset.for = target.getAttribute(MESSAGE_ATTR) ?? '';
			document.body.appendChild(tooltip);

			// Flipped above the text when there is no room below, which on a passage
			// dialog docked to the bottom of the window is most of the time.
			const height = tooltip.getBoundingClientRect().height;
			const below = rect.bottom + TOOLTIP_GAP;

			tooltip.style.left = `${Math.min(
				rect.left,
				Math.max(0, window.innerWidth - tooltip.getBoundingClientRect().width - 8)
			)}px`;
			tooltip.style.top =
				below + height > window.innerHeight
					? `${Math.max(0, rect.top - height - TOOLTIP_GAP)}px`
					: `${below}px`;
		}

		wrapper.addEventListener('mousemove', handleOver);
		wrapper.addEventListener('mouseleave', hide);

		return () => {
			wrapper.removeEventListener('mousemove', handleOver);
			wrapper.removeEventListener('mouseleave', hide);
			hide();

			for (const mark of marks) {
				mark.clear();
			}

			for (const line of tinted) {
				editor.removeLineClass(line, 'background', 'sliders-error-line');
				editor.removeLineClass(line, 'background', 'sliders-warning-line');
			}
		};
	}, [editor, errors]);
}
