import * as React from 'react';
import type {SceneParse} from '../../dialogs/passage-edit/scene-preview/use-scene-parse';

/**
 * Which passage the route-level preview should show, and what the passage editor already
 * knows about it.
 *
 * A passage editor publishes this; the preview dialog is the only consumer. The text is
 * NOT here: the preview acquires the passage's Doc from the registry itself, so it is
 * writable whether or not an editor is open (`store/passage-docs`).
 */
export interface ScenePreviewSource {
	passageId: string;
	storyId: string;
	/** The parse of the Doc's text, shared with the error list and the editor's own marks. */
	parse: SceneParse;
	onOpenPassage?: (name: string) => void;
	/** A background card in the dialog stack. Never drives the preview. */
	disabled?: boolean;
}

interface RegisteredSource extends ScenePreviewSource {
	/** Monotonic. The newest activation among the cards that are not disabled wins. */
	activatedAt: number;
}

interface ScenePreviewSourceContextProps {
	active: () => RegisteredSource | undefined;
	activate: (passageId: string) => void;
	publish: (source: ScenePreviewSource) => void;
	subscribe: (listener: () => void) => () => void;
	unpublish: (passageId: string) => void;
}

const noop = () => {};

export const ScenePreviewSourceContext =
	React.createContext<ScenePreviewSourceContextProps>({
		active: () => undefined,
		activate: noop,
		publish: noop,
		subscribe: () => noop,
		unpublish: noop
	});

ScenePreviewSourceContext.displayName = 'ScenePreviewSource';

/**
 * The registry connecting open passage editors to the route's scene preview.
 *
 * Deliberately NOT React state. A publish happens on every keystroke, and state here would
 * re-render the whole story edit route — map included — for each one. The entries live in a
 * ref and interested components subscribe, so only the preview dialog re-renders, exactly
 * as only the in-dialog preview used to.
 */
export const ScenePreviewSourceProvider: React.FC = props => {
	const entries = React.useRef(new Map<string, RegisteredSource>());
	const listeners = React.useRef(new Set<() => void>());
	const clock = React.useRef(0);

	const value = React.useMemo<ScenePreviewSourceContextProps>(() => {
		const notify = () => listeners.current.forEach(listener => listener());

		return {
			active() {
				let best: RegisteredSource | undefined;

				entries.current.forEach(entry => {
					if (!entry.disabled && (!best || entry.activatedAt > best.activatedAt)) {
						best = entry;
					}
				});

				return best;
			},
			activate(passageId) {
				const entry = entries.current.get(passageId);

				if (!entry) {
					return;
				}

				clock.current++;
				entries.current.set(passageId, {
					...entry,
					activatedAt: clock.current
				});
				notify();
			},
			publish(source) {
				const previous = entries.current.get(source.passageId);

				if (previous === undefined) {
					clock.current++;
				}

				entries.current.set(source.passageId, {
					...source,
					activatedAt: previous?.activatedAt ?? clock.current
				});
				notify();
			},
			subscribe(listener) {
				listeners.current.add(listener);

				return () => {
					listeners.current.delete(listener);
				};
			},
			unpublish(passageId) {
				entries.current.delete(passageId);
				notify();
			}
		};
	}, []);

	return (
		<ScenePreviewSourceContext.Provider value={value}>
			{props.children}
		</ScenePreviewSourceContext.Provider>
	);
};

/**
 * Offers this passage editor's scene to the preview dialog.
 *
 * The entry is refreshed whenever the parse changes, and claims the preview when the card
 * comes to the front of the stack or its CodeMirror (`view`) takes focus — the two gestures
 * that mean "this is the passage I am working on".
 */
export function usePublishScenePreview(
	source: ScenePreviewSource,
	editor?: CodeMirror.Editor
): void {
	const {activate, publish, unpublish} = React.useContext(
		ScenePreviewSourceContext
	);
	const {disabled, onOpenPassage, parse, passageId, storyId} = source;

	// First, so that the activations below always find an entry to raise.
	React.useEffect(() => {
		publish({disabled, onOpenPassage, parse, passageId, storyId});
	}, [disabled, onOpenPassage, parse, passageId, publish, storyId]);

	React.useEffect(() => {
		if (!disabled) {
			activate(passageId);
		}
	}, [activate, disabled, passageId]);

	React.useEffect(() => {
		if (!editor) {
			return;
		}

		const handler = () => activate(passageId);

		editor.on('focus', handler);

		return () => editor.off('focus', handler);
	}, [activate, editor, passageId]);

	React.useEffect(() => () => unpublish(passageId), [passageId, unpublish]);
}

/** The passage the preview should be showing, or undefined when no editor is open. */
export function useScenePreviewSource(): ScenePreviewSource | undefined {
	const {active, subscribe} = React.useContext(ScenePreviewSourceContext);
	const [source, setSource] = React.useState(active);

	React.useEffect(
		() => subscribe(() => setSource(active())),
		[active, subscribe]
	);

	return source;
}
