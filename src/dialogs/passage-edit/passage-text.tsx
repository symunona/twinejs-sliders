import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {DialogEditor} from '../../components/container/dialog-card';
import {CodeArea} from '../../components/control/code-area';
import {usePrefsContext} from '../../store/prefs';
import {Passage, Story} from '../../store/stories';
import {StoryFormat} from '../../store/story-formats';
import {useCodeMirrorPassageHints} from '../../store/use-codemirror-passage-hints';
import {useFormatCodeMirrorMode} from '../../store/use-format-codemirror-mode';
import {codeMirrorOptionsFromPrefs} from '../../util/codemirror-options';
import {useSceneHints} from './use-scene-hints';

export interface PassageTextProps {
	disabled?: boolean;
	onChange: (value: string) => void;
	onEditorChange: (value: CodeMirror.Editor) => void;
	/**
	 * Every keystroke, undebounced. `onChange` is a full second stale by design (see
	 * below), which is fine for the story map and useless for the scene preview: a drag
	 * has to read the document the author is looking at, not the one from a second ago.
	 */
	onLiveChange?: (value: string) => void;
	passage: Passage;
	story: Story;
	storyFormat: StoryFormat;
	storyFormatExtensionsDisabled?: boolean;
}

export const PassageText: React.FC<PassageTextProps> = props => {
	const {
		disabled,
		onChange,
		onEditorChange,
		onLiveChange,
		passage,
		story,
		storyFormat,
		storyFormatExtensionsDisabled
	} = props;
	const [localText, setLocalText] = React.useState(passage.text);
	const {prefs} = usePrefsContext();
	const autocompletePassageNames = useCodeMirrorPassageHints(story);
	const autocompleteSceneNames = useSceneHints();
	const mode =
		useFormatCodeMirrorMode(storyFormat.name, storyFormat.version) ?? 'text';
	const codeAreaContainerRef = React.useRef<HTMLDivElement>(null);
	const {t} = useTranslation();

	// These are refs so that changing them doesn't trigger a rerender, and more
	// importantly, no React effects fire.

	const onChangeText = React.useRef<string>();
	const onChangeTimeout = React.useRef<number>();

	const commitPendingChange = React.useCallback(() => {
		onChangeTimeout.current = undefined;
		onChange(onChangeText.current!);
	}, [onChange]);

	const scheduleCommit = React.useCallback(() => {
		onChangeTimeout.current = window.setTimeout(commitPendingChange, 1000);
	}, [commitPendingChange]);

	const flushPendingChange = React.useCallback(() => {
		if (onChangeTimeout.current) {
			window.clearTimeout(onChangeTimeout.current);
			commitPendingChange();
		}
	}, [commitPendingChange]);

	// Effects to handle debouncing updates upward. The idea here is that the
	// component maintains a local state so that the CodeMirror instance always is
	// up-to-date with what the user has typed, but the global context may not be.
	// This is because updating global context causes re-rendering in the story
	// map, which can be time-intensive.

	React.useEffect(() => {
		// A change to passage text has occurred externally, e.g. through a find and
		// replace. We ignore this if a change is pending so that users don't see
		// things they've typed in disappear or be replaced.

		if (!onChangeTimeout.current && localText !== passage.text) {
			setLocalText(passage.text);
		}
	}, [localText, passage.text]);

	const handleLocalChangeText = React.useCallback(
		(text: string) => {
			// ORDER MATTERS, and not for style. The pending-commit timeout is what the
			// effect above uses to tell "the author is typing" from "the text changed
			// underneath us"; with no timeout set it treats the new text as external and
			// resets it. Typing goes through a React synthetic event, so those updates are
			// batched and the timeout is always set by the time effects run — but a write
			// from a native listener (the scene editor's pointerup) is NOT batched, so
			// `setLocalText` re-renders and flushes effects synchronously, mid-function.
			// Schedule first and the guard holds either way.

			if (onChangeTimeout.current) {
				window.clearTimeout(onChangeTimeout.current);
			}

			onChangeText.current = text;
			scheduleCommit();

			// Set local state because the CodeMirror instance is controlled, and
			// updates there should be immediate.

			setLocalText(text);

			// Synchronous, alongside the debounced path and never instead of it: the
			// preview needs the text now, the story map does not, and committing to the
			// store on every keystroke is what the debounce exists to avoid.

			onLiveChange?.(text);
		},
		[onEditorChange, onLiveChange, scheduleCommit]
	);

	// If the onChange prop changes while an onChange call is pending, reset the
	// timeout and point it to the correct callback.

	React.useEffect(() => {
		if (onChangeTimeout.current) {
			window.clearTimeout(onChangeTimeout.current);
			scheduleCommit();
		}
	}, [scheduleCommit]);

	const handleMount = React.useCallback(
		(editor: CodeMirror.Editor) => {
			onEditorChange(editor);

			// The potential combination of loading a mode and the dialog entrance
			// animation seems to mess up CodeMirror's cursor rendering. The delay below
			// is intended to run after the animation completes.

			window.setTimeout(() => {
				editor.focus();
				editor.refresh();
			}, 400);
		},
		[onEditorChange]
	);

	// Emulate the above behavior re: focus if we aren't using CodeMirror.

	React.useEffect(() => {
		if (!prefs.useCodeMirror && codeAreaContainerRef.current) {
			const area = codeAreaContainerRef.current.querySelector('textarea');

			if (!area) {
				return;
			}

			area.focus();
			area.setSelectionRange(area.value.length, area.value.length);
		}
	}, []);

	const options = React.useMemo(
		() => ({
			...codeMirrorOptionsFromPrefs(prefs),
			mode: storyFormatExtensionsDisabled ? 'text' : mode,
			// Scene autocomplete is a CodeMirror key, not an app hotkey: it only
			// means anything with the cursor in the text, and routing it through
			// the app dispatcher would fight the editor for the keystroke.
			extraKeys: {'Ctrl-Space': autocompleteSceneNames},
			lineWrapping: true,
			placeholder: t('dialogs.passageEdit.passageTextPlaceholder'),
			prefixTrigger: {
				callback: autocompletePassageNames,
				prefixes: ['[[', '->']
			},
			// This value prevents the area from being focused.
			readOnly: disabled ? 'nocursor' : false
		}),
		[
			autocompletePassageNames,
			autocompleteSceneNames,
			disabled,
			mode,
			prefs,
			storyFormatExtensionsDisabled,
			t
		]
	);

	return (
		<DialogEditor ref={codeAreaContainerRef}>
			<CodeArea
				editorDidMount={handleMount}
				fontFamily={prefs.passageEditorFontFamily}
				fontScale={prefs.passageEditorFontScale}
				id={`passage-dialog-passage-text-code-area-${passage.id}`}
				label={t('dialogs.passageEdit.passageTextEditorLabel')}
				labelHidden
				onBlur={flushPendingChange}
				onChangeEditor={onEditorChange}
				onChangeText={handleLocalChangeText}
				options={options}
				useCodeMirror={prefs.useCodeMirror}
				value={localText}
			/>
		</DialogEditor>
	);
};
