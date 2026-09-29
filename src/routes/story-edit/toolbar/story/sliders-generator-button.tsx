import {IconWand} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../../components/control/icon-button';
import {AssetGeneratorDialog, useDialogsContext} from '../../../../dialogs';
import {useCommand} from '../../../../hotkeys';

export const SlidersGeneratorButton: React.FC = () => {
	const {dispatch} = useDialogsContext();
	const {t} = useTranslation();

	const handleClick = React.useCallback(
		() =>
			dispatch({
				type: 'addDialog',
				component: AssetGeneratorDialog,
				// The history grid and the model list both want room.
				maximized: true
			}),
		[dispatch]
	);

	// Global and allowed in text fields, like the asset manager: see
	// `SlidersAssetsButton`.

	useCommand({
		allowInInput: true,
		id: 'sliders.generator',
		label: t('hotkeys.commands.sliders.generator'),
		run: handleClick,
		scope: 'global'
	});

	return (
		<IconButton
			commandId="sliders.generator"
			icon={<IconWand />}
			label={t('routes.storyEdit.toolbar.slidersGenerator')}
			onClick={handleClick}
		/>
	);
};
