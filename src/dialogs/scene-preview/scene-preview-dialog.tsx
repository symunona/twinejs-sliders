import {
	IconArrowsMaximize,
	IconArrowsMinimize,
	IconCode,
	IconWalk
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {DialogCard} from '../../components/container/dialog-card';
import {IconButton} from '../../components/control/icon-button';
import {useCommand} from '../../hotkeys';
import {useScenePreviewSource} from '../../routes/story-edit/scene-preview-source-context';
import {useServerSyncContext} from '../../store/persistence/server/use-server-sync';
import {
	newPassagePositions,
	passageMatchingName,
	storyWithId
} from '../../store/stories';
import {
	useCreateLinkedPassage,
	useUndoableStoriesContext
} from '../../store/undoable-stories';
import {
	usePassageDoc,
	usePassageDocText,
	usePassageDocView
} from '../../store/passage-docs';
import {addPassageEditors, useDialogsContext} from '../context';
import {DialogComponentProps} from '../dialogs.types';
import {PassageLockBanner} from '../passage-edit/passage-lock-banner';
import {ScenePreview} from '../passage-edit/scene-preview/scene-preview';
import {usePreviewResolver} from '../passage-edit/scene-preview/use-preview-resolver';
import {useSceneParse} from '../passage-edit/scene-preview/use-scene-parse';
import type {WalkHereInfo} from '../passage-edit/scene-preview/use-walk-here';
import {setScenePreviewDismissed} from './preview-dismissal';
import './scene-preview-dialog.css';

export interface ScenePreviewDialogProps extends DialogComponentProps {
	storyId: string;
}

/**
 * The scene preview, once per story rather than once per passage editor.
 *
 * It is an ordinary dialog: normal is a card in the right-hand column beside the passage
 * editor, bigger is the dialog system's own maximize, and neither is geometry this file
 * knows anything about. Full screen is the exception, and the only reason there is a
 * header control here at all.
 *
 * It shows whichever passage the author is working in: the passage editor at the front of
 * the dialog stack if one is open, and otherwise the single passage selected on the map.
 * Either way it holds that passage's registry Doc and writes to it headless -- every
 * gesture is a text edit (spec 07), and the Doc is the text, editor open or not.
 */
export const ScenePreviewDialog: React.FC<ScenePreviewDialogProps> & {
	stackToBottom?: boolean;
} = props => {
	const {onClose, storyId, ...other} = props;
	const {dispatch: dialogsDispatch} = useDialogsContext();
	const {stories} = useUndoableStoriesContext();
	const story = storyWithId(stories, storyId);
	const assets = usePreviewResolver();
	const {lock, stealPassage} = useServerSyncContext();
	const published = useScenePreviewSource();
	const [fullScreen, setFullScreen] = React.useState(false);
	/**
	 * Walk-here: preview only, never written. Off by default, and not remembered -- it is
	 * a question asked of one backdrop, not a way of working.
	 */
	const [walkOn, setWalkOn] = React.useState(false);
	const [walker, setWalker] = React.useState<string>();
	const [walkInfo, setWalkInfo] = React.useState<WalkHereInfo>();
	const {t} = useTranslation();
	// An editor for another story would be a leftover; this dialog belongs to one story.
	const source = published?.storyId === story.id ? published : undefined;
	const selected = story.passages.filter(passage => passage.selected);
	/**
	 * The map's answer to "which passage", used only when no editor is open. Solo selection
	 * only: with two selected there is no one scene to show, the same rule the passage
	 * toolbar's actions follow.
	 */
	const fallback = !source && selected.length === 1 ? selected[0] : undefined;
	const passageId = source?.passageId ?? fallback?.id;
	const handle = usePassageDoc(story.id, passageId);
	const view = usePassageDocView(handle);
	const text = usePassageDocText(handle) ?? fallback?.text ?? '';
	// Unconditional, because hooks are. Parsing nothing is cheap and returns the empty parse.
	// An open editor already parses this Doc; reuse that one so the two never disagree.
	const fallbackParse = useSceneParse(source ? '' : text, story.passages);
	const parse = source?.parse ?? fallbackParse;
	/**
	 * Spec 11 soft lock: somebody else is in this passage. Read-only until "take edit",
	 * which shares it (both sides writable, both see the banner).
	 */
	const passageLock = passageId ? lock(story.id, passageId) : undefined;
	const readOnly = !!passageLock && !passageLock.shared;

	/**
	 * Ctrl/cmd-click on a link inside a scene bubble, when the preview is showing a passage
	 * nobody has open. Opens the target the same way a double click on the map does.
	 */
	const handleOpenPassage = React.useCallback(
		(name: string) => {
			// `passageMatchingName`, not an exact compare: the player follows a link into a
			// passage whose name differs only in case, so this gesture has to as well.
			const target = passageMatchingName(story.passages, name);

			if (target) {
				dialogsDispatch(addPassageEditors(story.id, [target.id]));
			}
		},
		[dialogsDispatch, story]
	);

	/**
	 * An error row in the sidebar: open this passage's `</>` editor with the caret on that
	 * line. The caret goes on the Doc now -- headless is fine, the editor mounts on the
	 * same Doc and finds it there. Focus has to wait for the view to exist.
	 */
	const focusPending = React.useRef(false);
	const handleGoToLine = React.useCallback(
		(line: number) => {
			if (!handle || !passageId) {
				return;
			}

			handle.doc.setCursor({ch: 0, line: line - 1});
			dialogsDispatch(addPassageEditors(story.id, [passageId]));
			focusPending.current = true;
		},
		[dialogsDispatch, handle, passageId, story.id]
	);

	React.useEffect(() => {
		if (focusPending.current && view) {
			focusPending.current = false;
			view.focus();
			view.scrollIntoView(null);
		}
	});

	/** Same fix the passage editor offers under its text, placed the same way. */
	const createLinkedPassage = useCreateLinkedPassage(story);
	const passage = story.passages.find(candidate => candidate.id === passageId);
	const handleCreatePassage = React.useCallback(
		(name: string) => {
			if (passage) {
				createLinkedPassage(name, newPassagePositions(story, passage, 1)[0]);
			}
		},
		[createLinkedPassage, passage, story]
	);


	useCommand({
		id: 'scene.walkHere',
		label: t('hotkeys.commands.scene.walkHere'),
		run: () => setWalkOn(on => !on),
		scope: 'scene-preview'
	});

	/** Why a click will not walk, in words. Absent when it will. */
	const walkNote = !walkOn
		? undefined
		: walkInfo?.blocked
		? t(`dialogs.passageEdit.scenePreview.walk.${walkInfo.blocked}`, {
				fx: walkInfo.fx
		  })
		: walkInfo?.unreachable
		? t('dialogs.passageEdit.scenePreview.walk.unreachable')
		: walkInfo?.noWalkPose
		? t('dialogs.passageEdit.scenePreview.walk.noWalkPose', {
				name:
					walkInfo.cast.find(member => member.id === walkInfo.walker)?.name ??
					walkInfo.walker
		  })
		: undefined;

	const walkControls = (
		<>
			<IconButton
				commandId="scene.walkHere"
				icon={<IconWalk />}
				iconOnly
				label={t('dialogs.passageEdit.scenePreview.walk.walkHere')}
				onClick={() => setWalkOn(!walkOn)}
				selectable
				selected={walkOn}
				tooltipLabel={t('dialogs.passageEdit.scenePreview.walk.walkHereHint')}
			/>
			{walkOn && (walkInfo?.cast.length ?? 0) > 0 && (
				<select
					aria-label={t('dialogs.passageEdit.scenePreview.walk.walker')}
					className="scene-preview-walker"
					data-testid="scene-preview-walker"
					onChange={event => setWalker(event.target.value)}
					value={walkInfo?.walker ?? ''}
				>
					{walkInfo?.cast.map(member => (
						<option key={member.id} value={member.id}>
							{member.name}
						</option>
					))}
				</select>
			)}
			{walkNote && (
				<span
					className="scene-preview-walk-note"
					data-testid="scene-preview-walk-note"
					title={walkNote}
				>
					{walkNote}
				</span>
			)}
		</>
	);

	// Closing is a decision, not an accident: it stops the preview letting itself in the
	// next time a scene appears, until the author asks for it again.
	const handleClose = React.useCallback(
		(event?: React.KeyboardEvent | React.MouseEvent) => {
			setScenePreviewDismissed(true);
			onClose(event);
		},
		[onClose]
	);

	return (
		<DialogCard
			{...other}
			className="scene-preview-dialog"
			headerControls={
				<>
					{/* The passage's source: its `</>` editor, on the same Doc the stage
					    writes. Raised if already open. */}
					<IconButton
						disabled={!passageId}
						icon={<IconCode />}
						iconOnly
						label={t('dialogs.passageEdit.scenePreview.openSource')}
						onClick={() =>
							passageId &&
							dialogsDispatch(addPassageEditors(story.id, [passageId]))
						}
						tooltipPosition="bottom"
					/>
					<IconButton
						icon={fullScreen ? <IconArrowsMinimize /> : <IconArrowsMaximize />}
						iconOnly
						label={t('dialogs.passageEdit.scenePreview.fullScreen')}
						onClick={() => setFullScreen(!fullScreen)}
						tooltipPosition="bottom"
					/>
				</>
			}
			headerLabel={t('dialogs.passageEdit.scenePreview.title')}
			hotkeyScope="scene-preview"
			maximizable
			onClose={handleClose}
		>
			{/* Escape belongs to the preview, not to the card. React 16 bubbles events
			    up the React TREE, so a keypress in the full screen portal--which is
			    mounted on the body--still arrives here, and `DialogCard` reads Escape as
			    "close". Inside the preview it means leave full screen, or drop the
			    selection; either way the dialog must stay open. */}
			<div
				className="scene-preview-dialog-keys"
				onKeyDown={event => {
					if (event.key === 'Escape') {
						event.stopPropagation();
					}
				}}
			>
				{passageId && (
					<PassageLockBanner
						lock={passageLock}
						onTakeOver={() => {
							handle?.claim();
							stealPassage(story.id, passageId);
						}}
					/>
				)}
				<ScenePreview
					assets={assets}
					walkControls={walkControls}
					onWalkInfo={setWalkInfo}
					onCreatePassage={handleCreatePassage}
					onGoToLine={handleGoToLine}
					walkHere={{on: walkOn, walker}}
					doc={handle?.doc}
					fullScreen={fullScreen}
					onFullScreenChange={setFullScreen}
					onOpenPassage={source?.onOpenPassage ?? handleOpenPassage}
					parse={parse}
					passageId={passageId}
					passages={story.passages}
					readOnly={readOnly}
					storyId={story.id}
					stylesheet={story.stylesheet}
					text={text}
					view={view}
				/>
			</div>
		</DialogCard>
	);
};

// Under the passage editor in the column, not over it--see `stackWeight()` in
// dialogs/context/dialogs.tsx.
ScenePreviewDialog.stackToBottom = true;
