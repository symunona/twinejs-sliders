import {IconPhoto} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../../components/control/icon-button';
import {SlidersAssetsDialog, useDialogsContext} from '../../../../dialogs';

export const SlidersAssetsButton: React.FC = () => {
	const {dispatch} = useDialogsContext();
	const {t} = useTranslation();

	return (
		<IconButton
			icon={<IconPhoto />}
			label={t('routes.storyEdit.toolbar.slidersAssets')}
			onClick={() =>
				dispatch({type: 'addDialog', component: SlidersAssetsDialog})
			}
		/>
	);
};
