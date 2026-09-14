import {IconMovie} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../../components/control/icon-button';
import {useDialogsContext} from '../../../../dialogs';
import {
	ScenePreviewDialog,
	setScenePreviewDismissed
} from '../../../../dialogs/scene-preview';
import {useCommand} from '../../../../hotkeys';
import {Story} from '../../../../store/stories';

export interface ScenePreviewButtonProps {
	/**
	 * Fire the shortcut even while the author is typing. Only the passage editor's copy
	 * wants this; the map's key is unmodified enough to land in a text field.
	 */
	allowInInput?: boolean;
	/**
	 * Command this button answers to. The passage editor shows a second copy of it under
	 * its own ID, because the two want different keys--one is pressed with the map in
	 * front, the other with the cursor in the scene text.
	 */
	commandId?: string;
	hotkeyScope?: string;
	label?: string;
	story: Story;
}

/**
 * Shows the scene preview, or hides it if it is already up.
 *
 * The way back after closing it: the preview lets itself in the first time a scene
 * appears, and closing it says not to. Opening it from here says that again, the other
 * way round, which is why this clears the dismissal.
 */
export const ScenePreviewButton: React.FC<ScenePreviewButtonProps> = props => {
	const {
		allowInInput,
		commandId = 'scene.togglePreview',
		hotkeyScope = 'story-map',
		label,
		story
	} = props;
	const {dialogs, dispatch} = useDialogsContext();
	const {t} = useTranslation();
	const openIndex = dialogs.findIndex(
		dialog => dialog.component === ScenePreviewDialog
	);

	const handleClick = React.useCallback(() => {
		if (openIndex !== -1) {
			setScenePreviewDismissed(true);
			dispatch({type: 'removeDialog', index: openIndex});
			return;
		}

		setScenePreviewDismissed(false);
		dispatch({
			type: 'addDialog',
			component: ScenePreviewDialog,
			props: {storyId: story.id}
		});
	}, [dispatch, openIndex, story.id]);

	useCommand({
		allowInInput,
		id: commandId,
		label: t(`hotkeys.commands.${commandId}`),
		run: handleClick,
		scope: hotkeyScope
	});

	return (
		<IconButton
			icon={<IconMovie />}
			label={label ?? t('routes.storyEdit.toolbar.scenePreview')}
			onClick={handleClick}
			selectable
			selected={openIndex !== -1}
		/>
	);
};
