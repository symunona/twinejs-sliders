import {IconUsers} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../../components/control/icon-button';
import {SlidersCharactersDialog, useDialogsContext} from '../../../../dialogs';

export const SlidersCharactersButton: React.FC = () => {
	const {dispatch} = useDialogsContext();
	const {t} = useTranslation();

	return (
		<IconButton
			icon={<IconUsers />}
			label={t('routes.storyEdit.toolbar.slidersCharacters')}
			onClick={() =>
				dispatch({type: 'addDialog', component: SlidersCharactersDialog})
			}
		/>
	);
};
