import {IconPhoto} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../../components/control/icon-button';
import {SlidersAssetsDialog, useDialogsContext} from '../../../../dialogs';
import {useCommand} from '../../../../hotkeys';

export const SlidersAssetsButton: React.FC = () => {
	const {dispatch} = useDialogsContext();
	const {t} = useTranslation();

	const handleClick = React.useCallback(
		() => dispatch({type: 'addDialog', component: SlidersAssetsDialog}),
		[dispatch]
	);

	useCommand({
		id: 'sliders.assets',
		label: t('hotkeys.commands.sliders.assets'),
		run: handleClick,
		scope: 'story-map'
	});

	return (
		<IconButton
			icon={<IconPhoto />}
			label={t('routes.storyEdit.toolbar.slidersAssets')}
			onClick={handleClick}
		/>
	);
};
