/**
 * Ctrl/cmd-click a link in the passage text to open the passage it points at.
 *
 * The same gesture the scene preview already offers on a rendered bubble, and the same
 * destination a double click on the story map reaches — but from the source, which is
 * where an author writing a branch actually is. Both markups answer: a `[[wiki link]]`
 * anywhere in the passage, and a scene's `links:` targets and entity `link:` values.
 *
 * Holding the modifier underlines what is clickable, because a gesture with no affordance
 * is a feature nobody finds. The marks are built on the keypress and torn down on release
 * rather than kept in sync with the document: a passage holds a handful of links, and a
 * stale mark would underline text that no longer is one.
 */

import {Editor, TextMarker} from 'codemirror';
import * as React from 'react';
import {passageLinkAt, passageLinkSpans} from '../../util/passage-link-spans';
import './ctrl-click-links.css';

const ARMED_CLASS = 'sliders-ctrl-link-armed';
const LINK_CLASS = 'sliders-ctrl-link';

/** Cmd on a Mac, ctrl everywhere else — accept either rather than sniffing the platform. */
function modifierHeld(event: KeyboardEvent | MouseEvent): boolean {
	return event.ctrlKey || event.metaKey;
}

export function useCtrlClickLinks(
	editor: Editor | undefined,
	onOpenPassage: ((name: string) => void) | undefined
): void {
	React.useEffect(() => {
		if (!editor || !onOpenPassage) {
			return;
		}

		const wrapper = editor.getWrapperElement();
		let marks: TextMarker[] = [];
		let armed = false;

		function disarm() {
			if (!armed) {
				return;
			}

			armed = false;
			wrapper.classList.remove(ARMED_CLASS);

			for (const mark of marks) {
				mark.clear();
			}

			marks = [];
		}

		function arm() {
			if (armed) {
				return;
			}

			armed = true;
			wrapper.classList.add(ARMED_CLASS);
			marks = passageLinkSpans(editor!.getValue()).map(span =>
				editor!.markText(
					editor!.posFromIndex(span.start),
					editor!.posFromIndex(span.end),
					{className: LINK_CLASS}
				)
			);
		}

		function handleKeyDown(event: KeyboardEvent) {
			if (modifierHeld(event)) {
				arm();
			} else {
				disarm();
			}
		}

		function handleKeyUp(event: KeyboardEvent) {
			if (!modifierHeld(event)) {
				disarm();
			}
		}

		function handleMouseDown(_: Editor, event: MouseEvent) {
			// Left button only. Ctrl-click is the right-click of last resort on a Mac, and
			// a context menu that navigated instead would be a trap.
			if (!modifierHeld(event) || event.button !== 0) {
				return;
			}

			const pos = editor!.coordsChar(
				{left: event.clientX, top: event.clientY},
				'window'
			);
			const link = passageLinkAt(editor!.getValue(), editor!.indexFromPos(pos));

			if (!link) {
				return;
			}

			// Stops CodeMirror doing its own thing with the click — on a Mac cmd-click
			// drops a second cursor, and the author would land in two documents at once.
			event.preventDefault();
			disarm();
			onOpenPassage!(link.target);
		}

		// On the document, not the wrapper: the modifier is usually pressed with the mouse
		// already over the text and the focus wherever it was, and a listener on an
		// unfocused editor would never hear the key.
		document.addEventListener('keydown', handleKeyDown);
		document.addEventListener('keyup', handleKeyUp);
		// Alt-tabbing away with ctrl held swallows the keyup, leaving the text underlined
		// and nothing to un-underline it.
		window.addEventListener('blur', disarm);
		editor.on('mousedown', handleMouseDown);

		return () => {
			document.removeEventListener('keydown', handleKeyDown);
			document.removeEventListener('keyup', handleKeyUp);
			window.removeEventListener('blur', disarm);
			editor.off('mousedown', handleMouseDown);
			disarm();
		};
	}, [editor, onOpenPassage]);
}
