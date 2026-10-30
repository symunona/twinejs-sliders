/**
 * The scene editor opened on a BLANK passage starts it with an empty scene, instead of
 * showing nothing at all.
 *
 * When: the dialog opens on it, the passage is opened for editing from the map (double
 * click, Edit -- `requestBlankSceneTemplate`), or the author clicks into the blank body.
 * Never on a mere map selection while the dialog is up: that is looking, not editing.
 *
 * What: the Insert Empty Scene block (`blankPassageScene`), backdrop from what the story
 * already uses or sees -- never one that creates or attaches art. One Doc change with its
 * own origin, so one Ctrl-Z takes it back.
 *
 * Only whitespace-only text is filled, and the check is repeated at the moment of writing.
 *
 * Leaving it untouched leaves nothing: when the dialog moves off the passage or closes and
 * the Doc still reads exactly the template, the write is undone. The hook holds its own ref
 * on the Doc for that, so the dialog's release cannot flush the template first.
 */

import * as React from 'react';
import {currentLibraryEngine} from '../../store/asset-library/engine-registry';
import {PassageDoc, usePassageDocRegistry} from '../../store/passage-docs';
import {
	blankPassageScene,
	isBlankPassageText,
	viewSceneBg
} from '../passage-edit/scene-preview/empty-scene';

/** Doc change origin. Not `+`-prefixed, so CodeMirror never merges it with typing. */
export const BLANK_TEMPLATE_ORIGIN = 'sceneTemplate';

let pending: string | undefined;
const listeners = new Set<() => void>();

/** "This passage was opened for editing." One-shot; the next mounted dialog takes it. */
export function requestBlankSceneTemplate(passageId: string): void {
	pending = passageId;
	listeners.forEach(listener => listener());
}

/** Tests only. */
export function clearBlankSceneTemplateRequest(): void {
	pending = undefined;
}

interface Held {
	own: PassageDoc;
	text: string;
	undo: number;
}

export interface BlankSceneTemplateOptions {
	handle: PassageDoc | undefined;
	/** The passage shown. The one shown on mount is the one the dialog opened on. */
	passageId: string | undefined;
	readOnly: boolean;
	story: {id: string; passages: {name: string; text: string}[]};
}

/** Returns "fill now" for the click-into case. A no-op unless blank and writable. */
export function useBlankSceneTemplate(
	options: BlankSceneTemplateOptions
): () => void {
	const {handle, passageId} = options;
	const registry = usePassageDocRegistry();
	const held = React.useRef<Held>();
	const live = React.useRef(options);
	const openedOn = React.useRef(passageId);
	const [version, setVersion] = React.useState(0);

	live.current = options;

	const fill = React.useCallback(() => {
		const {handle, readOnly, story} = live.current;

		if (!handle || readOnly) {
			return;
		}

		const doc = handle.doc;

		if (!isBlankPassageText(doc.getValue())) {
			return;
		}

		const text = blankPassageScene(viewSceneBg(currentLibraryEngine(), story));
		// Undone and clicked again: the ref already held is still ours.
		const own =
			held.current?.own ?? registry.acquire(handle.storyId, handle.passageId);

		doc.replaceRange(
			text,
			{ch: 0, line: 0},
			doc.posFromIndex(doc.getValue().length),
			BLANK_TEMPLATE_ORIGIN
		);
		held.current = {own, text, undo: doc.historySize().undo};
	}, [registry]);

	React.useEffect(() => {
		const listener = () => setVersion(current => current + 1);

		listeners.add(listener);

		return () => {
			listeners.delete(listener);
		};
	}, []);

	// Opened on it, or asked to.
	React.useEffect(() => {
		if (!handle) {
			return;
		}

		const asked = pending === handle.passageId;

		if (asked) {
			pending = undefined;
		}

		// Only the FIRST passage shown counts as opened on; later ones were picked.
		const opened = openedOn.current === handle.passageId;

		openedOn.current = undefined;

		if (asked || opened) {
			fill();
		}
	}, [fill, handle, version]);

	// Moving off the passage or closing: undo a template nobody touched, then let go.
	React.useLayoutEffect(
		() => () => {
			const current = held.current;

			if (!current) {
				return;
			}

			held.current = undefined;

			const doc = current.own.doc;

			if (
				doc.getValue() === current.text &&
				doc.historySize().undo === current.undo
			) {
				doc.undo();
			}

			registry.release(current.own);
		},
		[handle, registry]
	);

	return fill;
}
