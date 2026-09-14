import {IconPhoto} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../../components/control/icon-button';
import {SlidersAssetsDialog, useDialogsContext} from '../../../../dialogs';
import {useCommand} from '../../../../hotkeys';

export interface SlidersAssetsButtonProps {
	/**
	 * Fire the shortcut even while the author is typing. Only the passage editor's copy
	 * wants this--the map's key is a bare letter, and a bare letter must never fire out
	 * of a text field.
	 */
	allowInInput?: boolean;
	/**
	 * Command this button answers to. The passage editor shows a second copy under its
	 * own ID so that the two can carry different keys--see `ScenePreviewButton`.
	 */
	commandId?: string;
	hotkeyScope?: string;
}

export const SlidersAssetsButton: React.FC<SlidersAssetsButtonProps> = props => {
	const {
		allowInInput,
		commandId = 'sliders.assets',
		hotkeyScope = 'story-map'
	} = props;
	const {dispatch} = useDialogsContext();
	const {t} = useTranslation();

	const handleClick = React.useCallback(
		() => dispatch({type: 'addDialog', component: SlidersAssetsDialog}),
		[dispatch]
	);

	useCommand({
		allowInInput,
		id: commandId,
		label: t(`hotkeys.commands.${commandId}`),
		run: handleClick,
		scope: hotkeyScope
	});

	return (
		<IconButton
			icon={<IconPhoto />}
			label={t('routes.storyEdit.toolbar.slidersAssets')}
			onClick={handleClick}
		/>
	);
};
