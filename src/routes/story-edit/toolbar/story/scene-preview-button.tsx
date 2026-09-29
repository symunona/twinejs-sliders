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
 * A hook rather than a handler inside the button, so that anything else that wants to
 * show the preview toggles it the same way.
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
	 * Scope the shortcut registers in, or null to register nothing--the passage editor's
	 * copy passes null, because the story map toolbar's copy owns the registration. See
	 * `SlidersAssetsButton`.
	 */
	hotkeyScope?: string | null;
	label?: string;
	story: Story;
}

export const ScenePreviewButton: React.FC<ScenePreviewButtonProps> = props => {
	const {hotkeyScope = 'global', label, story} = props;
	const {open, toggle} = useScenePreviewToggle(story.id);
	const {t} = useTranslation();

	// Global, and allowed in text fields: `alt+p` types nothing, and it has to work from
	// the map, the passage text, and every dialog alike.

	useCommand({
		allowInInput: true,
		id: 'scene.togglePreview',
		label: t('hotkeys.commands.scene.togglePreview'),
		run: toggle,
		scope: hotkeyScope
	});

	return (
		<IconButton
			commandId="scene.togglePreview"
			icon={<IconMovie />}
			label={label ?? t('routes.storyEdit.toolbar.scenePreview')}
			onClick={toggle}
			selectable
			selected={open}
		/>
	);
};
