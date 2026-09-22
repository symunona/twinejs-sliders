import * as React from 'react';
import {useTranslation} from 'react-i18next';
import useErrorBoundary from 'use-error-boundary';
import {ErrorMessage} from '../../components/error';
import {useServerSyncContext} from '../../store/persistence/server/use-server-sync';
import {
	newPassagePositions,
	passageMatchingName,
	passageWithId,
	storyWithId,
	updatePassage
} from '../../store/stories';
import {
	formatWithNameAndVersion,
	useStoryFormatsContext
} from '../../store/story-formats';
import {
	useCreateLinkedPassage,
	useUndoableStoriesContext
} from '../../store/undoable-stories';
import type {SceneFix} from '@sliders/scene-types';
import {addPassageEditors, useDialogsContext} from '../context';
import {PassageText} from './passage-text';
import {PassageToolbar} from './passage-toolbar';
import {SceneErrors} from './scene-errors/scene-errors';
import {useSceneErrorMarks} from './scene-errors/use-error-marks';
import {useCtrlClickLinks} from './use-ctrl-click-links';
import {
	interceptScenePrefill,
	sceneLinkSeeds
} from './scene-preview/prefill-links';
import {insertSceneAutoAdvance} from './scene-preview/insert-scene-pref';
import {useSceneParse} from './scene-preview/use-scene-parse';
import {FIX_ORIGIN} from './scene-preview/use-scene-writer';
import {useLastSceneTracker} from './scene-preview/use-last-scene';
import {usePublishScenePreview} from '../../routes/story-edit/scene-preview-source-context';
import {useScenePreviewToggle} from '../../routes/story-edit/toolbar/story/scene-preview-button';
import {useOpenSlidersAssets} from '../../routes/story-edit/toolbar/story/sliders-assets-button';
import {PassageLockBanner} from './passage-lock-banner';
import {StoryFormatToolbar} from './story-format-toolbar';
import './passage-edit-contents.css';
import {useCommand} from '../../hotkeys';
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
	 * Ctrl/cmd-click on a link, either in a scene bubble in the preview or on the link's own
	 * text in the editor. Opens the passage it points at, the same editor stack a double
	 * click on the story map opens. A link to a passage that does not exist yet does nothing
	 * — this gesture navigates, it does not author.
	 */
	const handleOpenPassage = React.useCallback(
		(name: string) => {
			// `passageMatchingName`, not an exact compare: the reader's click follows
			// `[[start]]` into a passage called `Start`, so the author's must too.
			const target = passageMatchingName(story.passages, name);

			if (target) {
				dialogsDispatch(addPassageEditors(story.id, [target.id]));
			}
		},
		[dialogsDispatch, story]
	);

	useCtrlClickLinks(cmEditor, handleOpenPassage);

	/**
	 * The fix offered on a link whose target does not exist. Shared with the ghost card on
	 * the story map — see `useCreateLinkedPassage` for why creation is explicit here.
	 * Placement is `newPassagePositions`, the same function the automatic `[[…]]` path
	 * uses, so both put the new card in the same place.
	 */
	const createLinkedPassage = useCreateLinkedPassage(story);
	const handleCreatePassage = React.useCallback(
		(name: string) =>
			createLinkedPassage(name, newPassagePositions(story, passage, 1)[0]),
		[createLinkedPassage, passage, story]
	);

	/**
	 * Applies the mechanical repair an error carries.
	 *
	 * One `replaceRange`, so the fix is one undo entry, and guarded on the text still being
	 * what the parse saw: `parse` is debounced, so between the error being computed and this
	 * button being clicked the author may have typed over the very span it points at.
	 * Refusing is the whole point of `fix.replaces` — a fix that splices its suggestion over
	 * something else is worse than no button.
	 */
	const handleApplyFix = React.useCallback(
		(fix: SceneFix) => {
			if (!cmEditor) {
				return;
			}

			const from = {ch: fix.col - 1, line: fix.line - 1};
			const to = {
				ch: fix.endCol === undefined ? fix.col - 1 : fix.endCol - 1,
				line: (fix.endLine ?? fix.line) - 1
			};

			if (cmEditor.getRange(from, to) !== fix.replaces) {
				return;
			}

			cmEditor.replaceRange(fix.text, from, to, FIX_ORIGIN);
			cmEditor.focus();
		},
		[cmEditor]
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

	// Alt+P and Alt+A are registered here rather than by the toolbar buttons that run the
	// same two actions. The buttons live in `<StoryFormatToolbar>`, which is behind three
	// separate conditions--the toolbars preference, the CodeMirror preference, and the
	// format's extensions not having crashed--and a command that is only registered while
	// its button happens to be visible is a key that silently does nothing. These are the
	// two keys an author presses with the cursor in the scene text, which is exactly when
	// the toolbar is least likely to be in the way and most likely to be switched off.
	//
	// Scope null on a background card: every card in the stack renders these contents, and
	// only the one in front should answer.

	const openAssets = useOpenSlidersAssets();
	const {toggle: toggleScenePreview} = useScenePreviewToggle(storyId);
	const sceneCommandScope = disabled ? null : 'passage-editor';

	useCommand({
		allowInInput: true,
		id: 'scene.edit',
		label: t('hotkeys.commands.scene.edit'),
		run: toggleScenePreview,
		scope: sceneCommandScope
	});
	useCommand({
		allowInInput: true,
		id: 'scene.assets',
		label: t('hotkeys.commands.scene.assets'),
		run: openAssets,
		scope: sceneCommandScope
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
			sceneLinkSeeds(passage.name, sceneText, story.passages),
			// A template seed and nothing more: it fills in the skeleton's inert
			// `autoAdvance: ~` so a story with one pace does not retype it per scene.
			insertSceneAutoAdvance()
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
		// The `passage-editor` scope is declared by the dialog card around this, not here:
		// a scope on these contents only resolves while focus is inside them, and the
		// editor's own Escape handler moves focus out to the card.
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
							story={story}
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
					onApplyFix={readOnly ? undefined : handleApplyFix}
					onCreatePassage={readOnly ? undefined : handleCreatePassage}
					onGoToLine={line => cmEditor?.setCursor({ch: 0, line: line - 1})}
				/>
			)}
		</div>
	);
};
