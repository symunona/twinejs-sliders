import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {DialogEditor} from '../../components/container/dialog-card';
import {DocCodeArea} from '../../components/control/code-area/doc-code-area';
import {PassageDoc} from '../../store/passage-docs';
import {usePrefsContext} from '../../store/prefs';
import {Passage, Story} from '../../store/stories';
import {StoryFormat} from '../../store/story-formats';
import {useCodeMirrorPassageHints} from '../../store/use-codemirror-passage-hints';
import {useFormatCodeMirrorMode} from '../../store/use-format-codemirror-mode';
import {codeMirrorOptionsFromPrefs} from '../../util/codemirror-options';
import {
	sceneTemplateNames,
	useSceneHints,
	useTypedNameAttach
} from './use-scene-hints';

export interface PassageTextProps {
	disabled?: boolean;
	/** The passage's registry Doc. Text, history and the debounced commit live there. */
	handle: PassageDoc;
	onEditorChange: (value: CodeMirror.Editor | undefined) => void;
	passage: Passage;
	story: Story;
	storyFormat: StoryFormat;
	storyFormatExtensionsDisabled?: boolean;
}

/**
 * The `</>` view onto the passage's Doc.
 *
 * Owns nothing about the text any more: the Doc is the model and the registry commits it
 * (`passage-doc-registry.ts`). This is options, hints and focus.
 */
export const PassageText: React.FC<PassageTextProps> = props => {
	const {
		disabled,
		handle,
		onEditorChange,
		passage,
		story,
		storyFormat,
		storyFormatExtensionsDisabled
	} = props;
	const {prefs} = usePrefsContext();
	const autocompletePassageNames = useCodeMirrorPassageHints(story);
	const passageNames = React.useMemo(
		() => story.passages.map(passage => passage.name),
		[story.passages]
	);
	// A scene cannot inherit from itself, and picking its own name from a dropdown is the
	// easiest way to write that cycle.
	const sceneTemplates = React.useMemo(
		() =>
			sceneTemplateNames(
				story.passages
					// Store identity: this passage itself, not a name being resolved.
					// eslint-disable-next-line no-restricted-syntax
					.filter(other => other.name !== passage.name)
					.map(other => ({name: other.name, text: other.text}))
			),
		[passage.name, story.passages]
	);
	const autocompleteSceneNames = useSceneHints(passageNames, sceneTemplates);
	const attachTyped = useTypedNameAttach();
	const mode =
		useFormatCodeMirrorMode(storyFormat.name, storyFormat.version) ?? 'text';
	const codeAreaContainerRef = React.useRef<HTMLDivElement>(null);
	const hintsRef = React.useRef(autocompleteSceneNames);
	const {t} = useTranslation();

	hintsRef.current = autocompleteSceneNames;

	const handleEditor = React.useCallback(
		(editor: CodeMirror.Editor | undefined) => {
			onEditorChange(editor);

			if (!editor) {
				return;
			}

			// Opening a flow map is a question: what goes in here? Answer it without
			// waiting for Ctrl-Space. The hint itself decides whether the brace is in
			// a scene at all, so this is safe in prose and in other formats.

			editor.on('inputRead', (instance, change) => {
				if (change.text.length === 1 && change.text[0].endsWith('{')) {
					hintsRef.current(instance);
				}
			});

			// A name typed by hand from a pack the story has not attached: attach it.
			editor.on('inputRead', attachTyped);

			// The potential combination of loading a mode and the dialog entrance
			// animation seems to mess up CodeMirror's cursor rendering. The delay below
			// is intended to run after the animation completes.

			window.setTimeout(() => {
				if (editor.getOption('readOnly') !== 'nocursor') {
					editor.focus();
				}

				editor.refresh();
			}, 400);
		},
		[attachTyped, onEditorChange]
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
			lineNumbers: true,
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
			<DocCodeArea
				fontFamily={prefs.passageEditorFontFamily}
				fontScale={prefs.passageEditorFontScale}
				handle={handle}
				id={`passage-dialog-passage-text-code-area-${passage.id}`}
				label={t('dialogs.passageEdit.passageTextEditorLabel')}
				labelHidden
				onEditor={handleEditor}
				options={options}
				useCodeMirror={prefs.useCodeMirror}
			/>
		</DialogEditor>
	);
};
