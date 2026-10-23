import {IconFlame} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../../components/control/icon-button';
import {SlidersParticlesDialog, useDialogsContext} from '../../../../dialogs';
import {useCommand} from '../../../../hotkeys';

export const SlidersParticlesButton: React.FC = () => {
	const {dispatch} = useDialogsContext();
	const {t} = useTranslation();

	const handleClick = React.useCallback(
		() => dispatch({type: 'addDialog', component: SlidersParticlesDialog}),
		[dispatch]
	);

	// Global and allowed in text fields, like the asset manager: see
	// `SlidersAssetsButton`.

	useCommand({
		allowInInput: true,
		id: 'sliders.particles',
		label: t('hotkeys.commands.sliders.particles'),
		run: handleClick,
		scope: 'global'
	});

	return (
		<IconButton
			commandId="sliders.particles"
			icon={<IconFlame />}
			label={t('routes.storyEdit.toolbar.slidersParticles')}
			onClick={handleClick}
		/>
	);
};
