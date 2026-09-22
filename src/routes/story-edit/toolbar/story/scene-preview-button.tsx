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

/**
 * Shows the scene preview, or hides it if it is already up, plus whether it is up.
 *
 * The way back after closing it: the preview lets itself in the first time a scene
 * appears, and closing it says not to. Opening it from here says that again, the other
 * way round, which is why this clears the dismissal.
 *
 * A hook rather than a handler inside the button, because the passage editor binds the
 * same action to a key whether or not its toolbar--and so this button--is on screen. See
 * `PassageEditContents`.
 */
export function useScenePreviewToggle(storyId: string) {
	const {dialogs, dispatch} = useDialogsContext();
	const openIndex = dialogs.findIndex(
		dialog => dialog.component === ScenePreviewDialog
	);

	const toggle = React.useCallback(() => {
		if (openIndex !== -1) {
			setScenePreviewDismissed(true);
			dispatch({type: 'removeDialog', index: openIndex});
			return;
		}

		setScenePreviewDismissed(false);
		dispatch({
			type: 'addDialog',
			component: ScenePreviewDialog,
			props: {storyId}
		});
	}, [dispatch, openIndex, storyId]);

	return {open: openIndex !== -1, toggle};
}

export interface ScenePreviewButtonProps {
	/**
	 * Command this button answers to. The passage editor shows a second copy of it under
	 * its own ID, because the two want different keys--one is pressed with the map in
	 * front, the other with the cursor in the scene text.
	 */
	commandId?: string;
	/**
	 * Scope the shortcut registers in, or null to register nothing--the passage editor's
	 * copy passes null, because the editor itself owns that registration. The button
	 * still shows the key: the chip reads the keymap, not the registration.
	 */
	hotkeyScope?: string | null;
	label?: string;
	story: Story;
}

export const ScenePreviewButton: React.FC<ScenePreviewButtonProps> = props => {
	const {
		commandId = 'scene.togglePreview',
		hotkeyScope = 'story-map',
		label,
		story
	} = props;
	const {open, toggle} = useScenePreviewToggle(story.id);
	const {t} = useTranslation();

	useCommand({
		id: commandId,
		label: t(`hotkeys.commands.${commandId}`),
		run: toggle,
		scope: hotkeyScope
	});

	return (
		<IconButton
			commandId={commandId}
			icon={<IconMovie />}
			label={label ?? t('routes.storyEdit.toolbar.scenePreview')}
			onClick={toggle}
			selectable
			selected={open}
		/>
	);
};
