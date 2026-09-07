import {IconArrowsMaximize, IconArrowsMinimize} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {DialogCard} from '../../components/container/dialog-card';
import {IconButton} from '../../components/control/icon-button';
import {useScenePreviewSource} from '../../routes/story-edit/scene-preview-source-context';
import {storyWithId} from '../../store/stories';
import {useUndoableStoriesContext} from '../../store/undoable-stories';
import {addPassageEditors, useDialogsContext} from '../context';
import {DialogComponentProps} from '../dialogs.types';
import {ScenePreview} from '../passage-edit/scene-preview/scene-preview';
import {usePreviewResolver} from '../passage-edit/scene-preview/use-preview-resolver';
import {useSceneParse} from '../passage-edit/scene-preview/use-scene-parse';
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
 * The fallback has no CodeMirror to write through, so it is a picture -- every gesture is
 * a text edit (spec 07), and there is no text to edit without an editor.
 */
export const ScenePreviewDialog: React.FC<ScenePreviewDialogProps> & {
	stackToBottom?: boolean;
} = props => {
	const {onClose, storyId, ...other} = props;
	const {dispatch: dialogsDispatch} = useDialogsContext();
	const {stories} = useUndoableStoriesContext();
	const story = storyWithId(stories, storyId);
	const assets = usePreviewResolver();
	const published = useScenePreviewSource();
	const [fullScreen, setFullScreen] = React.useState(false);
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
	// Unconditional, because hooks are. Parsing nothing is cheap and returns the empty parse.
	const fallbackParse = useSceneParse(fallback?.text ?? '', story.passages);
	const parse = source?.parse ?? fallbackParse;

	/**
	 * Ctrl/cmd-click on a link inside a scene bubble, when the preview is showing a passage
	 * nobody has open. Opens the target the same way a double click on the map does.
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
				<IconButton
					icon={fullScreen ? <IconArrowsMinimize /> : <IconArrowsMaximize />}
					iconOnly
					label={t('dialogs.passageEdit.scenePreview.fullScreen')}
					onClick={() => setFullScreen(!fullScreen)}
					tooltipPosition="bottom"
				/>
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
				<ScenePreview
					assets={assets}
					editor={source?.editor}
					fullScreen={fullScreen}
					onFullScreenChange={setFullScreen}
					onOpenPassage={source?.onOpenPassage ?? handleOpenPassage}
					parse={parse}
					passages={story.passages}
					stylesheet={story.stylesheet}
					text={source?.text ?? fallback?.text ?? ''}
				/>
			</div>
		</DialogCard>
	);
};

// Under the passage editor in the column, not over it--see `stackWeight()` in
// dialogs/context/dialogs.tsx.
ScenePreviewDialog.stackToBottom = true;
