import {IconUsers} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../../components/control/icon-button';
import {SlidersCharactersDialog, useDialogsContext} from '../../../../dialogs';
import {useCommand} from '../../../../hotkeys';

export const SlidersCharactersButton: React.FC = () => {
	const {dispatch} = useDialogsContext();
	const {t} = useTranslation();

	const handleClick = React.useCallback(
		() => dispatch({type: 'addDialog', component: SlidersCharactersDialog}),
		[dispatch]
	);

	useCommand({
		id: 'sliders.characters',
		label: t('hotkeys.commands.sliders.characters'),
		run: handleClick,
		scope: 'story-map'
	});

	return (
		<IconButton
			icon={<IconUsers />}
			label={t('routes.storyEdit.toolbar.slidersCharacters')}
			onClick={handleClick}
		/>
	);
};
