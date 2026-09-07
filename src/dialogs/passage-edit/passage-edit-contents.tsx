import * as React from 'react';
import {useTranslation} from 'react-i18next';
import useErrorBoundary from 'use-error-boundary';
import {ErrorMessage} from '../../components/error';
import {useServerSyncContext} from '../../store/persistence/server/use-server-sync';
import {passageWithId, storyWithId, updatePassage} from '../../store/stories';
import {
	formatWithNameAndVersion,
	useStoryFormatsContext
} from '../../store/story-formats';
import {useUndoableStoriesContext} from '../../store/undoable-stories';
import {addPassageEditors, useDialogsContext} from '../context';
import {PassageText} from './passage-text';
import {PassageToolbar} from './passage-toolbar';
import {SceneErrors} from './scene-errors/scene-errors';
import {useSceneErrorMarks} from './scene-errors/use-error-marks';
import {
	interceptScenePrefill,
	sceneLinkSeeds
} from './scene-preview/prefill-links';
import {useSceneParse} from './scene-preview/use-scene-parse';
import {useLastSceneTracker} from './scene-preview/use-last-scene';
import {usePublishScenePreview} from '../../routes/story-edit/scene-preview-source-context';
import {PassageLockBanner} from './passage-lock-banner';
import {StoryFormatToolbar} from './story-format-toolbar';
import './passage-edit-contents.css';
import {usePrefsContext} from '../../store/prefs';

export interface PassageEditContentsProps {
	disabled?: boolean;
	passageId: string;
	storyId: string;
}

export const PassageEditContents: React.FC<
	PassageEditContentsProps
> = props => {
	const {disabled, passageId, storyId} = props;
	const [storyFormatExtensionsEnabled, setStoryFormatExtensionsEnabled] =
		React.useState(true);
	const [editorCrashed, setEditorCrashed] = React.useState(false);
	const [cmEditor, setCmEditor] = React.useState<CodeMirror.Editor>();
	// The store's copy of the text is a debounced second behind on purpose (see
	// `PassageText`), which is fine for the story map and useless for the scene preview:
	// a drag has to read the document the author is looking at.
	const [liveText, setLiveText] = React.useState<string>();
	const {ErrorBoundary, error, reset: resetError} = useErrorBoundary();
	const {prefs} = usePrefsContext();
	const {blurPassage, focusPassage, lock, stealPassage} =
		useServerSyncContext();
	const {dispatch, stories} = useUndoableStoriesContext();
	const {dispatch: dialogsDispatch} = useDialogsContext();
	const {formats} = useStoryFormatsContext();
	const passage = passageWithId(stories, storyId, passageId);
	const story = storyWithId(stories, storyId);
	const storyFormat = formatWithNameAndVersion(
		formats,
		story.storyFormat,
		story.storyFormatVersion
	);
	const {t} = useTranslation();
	// The scene text the author is looking at, undebounced (see `liveText` above).
	const sceneText = liveText ?? passage.text;
	/**
	 * One parse for the whole dialog. The error list, the editor's own marks and the scene
	 * preview dialog all read it, and parsing three times would let them disagree about what
	 * the scene currently says.
	 */
	const parse = useSceneParse(sceneText, story.passages);
	/**
	 * The soft lock (spec 11). `undefined` unless someone else has this passage open, and
	 * always `undefined` with no server or no socket, which is what makes presence a thing
	 * the editor can lose without noticing.
	 */
	const passageLock = lock(storyId, passageId);
	/**
	 * Read-only for two unrelated reasons, and they must not be conflated. `disabled` is
	 * a background card in the dialog stack; the lock is somebody else typing. A locked
	 * top card still holds its `focus` — it is open, just not writable.
	 */
	const readOnly = disabled || (!!passageLock && !passageLock.shared);

	useSceneErrorMarks(cmEditor, parse.errors);

	// Claim the passage while this editor is the one in front. Background cards in the
	// stack are `disabled` and stay silent: claiming a lock on a passage the author is
	// merely looking past would lock out someone who wants to work on it.
	React.useEffect(() => {
		if (disabled) {
			return;
		}

		focusPassage(storyId, passageId);

		return () => blurPassage(storyId, passageId);
	}, [blurPassage, disabled, focusPassage, passageId, storyId]);

	// Keeps the story format's "Insert Last Scene" toolbar item pointed at
	// whatever scene this author last worked on.
	useLastSceneTracker(passageId, passage.name, passage.text);

	React.useEffect(() => {
		if (error) {
			if (storyFormatExtensionsEnabled) {
				console.error(
					'Passage editor crashed, trying without format extensions',
					error
				);
				setStoryFormatExtensionsEnabled(false);
			} else {
				setEditorCrashed(true);
			}

			resetError();
		}
	}, [error, resetError, storyFormatExtensionsEnabled]);

	// The store catching up drops the local override rather than trying to merge with it:
	// after the debounced commit the two agree, and when the text changed from somewhere
	// else entirely — find and replace, undo — the store is the one that is right.
	React.useEffect(() => setLiveText(undefined), [passage.text]);

	/**
	 * Ctrl/cmd-click on a link inside a scene bubble. Opens the passage it points at, the
	 * same editor stack a double click on the story map opens. A link to a passage that does
	 * not exist yet does nothing — this gesture navigates, it does not author.
	 */
	const handleOpenPassage = React.useCallback(
		(name: string) => {
			const target = story.passages.find(passage => passage.name === name);

			if (target) {
				dialogsDispatch(addPassageEditors(story.id, [target.id]));
			}
		},
		[dialogsDispatch, story]
	);

	// The scene preview is a dialog of its own now, not a strip inside this one. All this
	// editor does is offer what it is holding; the preview decides whose scene is on
	// screen.
	usePublishScenePreview({
		disabled,
		editor: cmEditor,
		onOpenPassage: handleOpenPassage,
		parse,
		passageId,
		storyId,
		text: sceneText
	});

	const handlePassageTextChange = React.useCallback(
		(text: string) => {
			dispatch(updatePassage(story, passage, {text}));
		},
		[dispatch, passage, story]
	);

	function handleExecCommand(name: string) {
		// A format toolbar command probably will affect the editor content. It
		// appears that react-codemirror2 can't maintain the selection properly in
		// all cases when this happens (particularly when using
		// `replaceSelection('something', 'around')`), so we take a snapshot
		// immediately after the command runs, let react-codemirror2 work, then
		// reapply the selection ASAP.

		if (!cmEditor) {
			throw new Error('No editor set');
		}

		// "Insert Scene" drops a skeleton whose links: are a worked example. Point that
		// example at the links this passage already has. The rewrite has to wait for the
		// document to catch up, so it rides the same deferral the selection does.
		const prefill = interceptScenePrefill(
			cmEditor,
			sceneLinkSeeds(passage.name, sceneText, story.passages)
		);

		cmEditor.execCommand(name);

		const selections = cmEditor.listSelections();

		Promise.resolve().then(() => {
			prefill.finish();
			cmEditor.setSelections(selections);
		});
	}

	if (editorCrashed) {
		return (
			<ErrorMessage>{t('dialogs.passageEdit.editorCrashed')}</ErrorMessage>
		);
	}

	return (
		<div className="passage-edit-contents" aria-hidden={disabled}>
			{prefs.passageEditorToolbars && (
				<>
					<PassageToolbar
						disabled={readOnly}
						editor={cmEditor}
						passage={passage}
						story={story}
						useCodeMirror={prefs.useCodeMirror}
					/>
					{prefs.useCodeMirror && storyFormatExtensionsEnabled && (
						<StoryFormatToolbar
							disabled={readOnly}
							editor={cmEditor}
							onExecCommand={handleExecCommand}
							storyFormat={storyFormat}
						/>
					)}
				</>
			)}
			{!disabled && (
				<PassageLockBanner
					lock={passageLock}
					onTakeOver={() => stealPassage(storyId, passageId)}
				/>
			)}
			<ErrorBoundary>
				<PassageText
					disabled={readOnly}
					onChange={handlePassageTextChange}
					onEditorChange={setCmEditor}
					onLiveChange={setLiveText}
					passage={passage}
					story={story}
					storyFormat={storyFormat}
					storyFormatExtensionsDisabled={!storyFormatExtensionsEnabled}
				/>
			</ErrorBoundary>
			{parse.hasScene && (
				<SceneErrors
					errors={parse.errors}
					onGoToLine={line => cmEditor?.setCursor({ch: 0, line: line - 1})}
				/>
			)}
		</div>
	);
};
