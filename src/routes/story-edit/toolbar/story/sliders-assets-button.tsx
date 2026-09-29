import {IconPhoto} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../../components/control/icon-button';
import {SlidersAssetsDialog, useDialogsContext} from '../../../../dialogs';
import {useCommand} from '../../../../hotkeys';

/**
 * Opens the asset manager. A hook rather than a handler inside the button, so that
 * anything else that wants to open it--voice mode, a link in another dialog--opens it
 * the same way.
 */
export function useOpenSlidersAssets() {
	const {dispatch} = useDialogsContext();

	return React.useCallback(
		// Maximized: the Library has a collections rail beside the grid.
		() =>
			dispatch({
				type: 'addDialog',
				component: SlidersAssetsDialog,
				maximized: true
			}),
		[dispatch]
	);
}

export interface SlidersAssetsButtonProps {
	/**
	 * Scope the shortcut registers in, or null to register nothing--the passage editor's
	 * copy passes null, because the story map toolbar's copy owns the registration. That
	 * one is always mounted: the toolbar renders every tab and hides the unselected ones
	 * in CSS. The button still shows the key: the chip reads the keymap, not the
	 * registration.
	 */
	hotkeyScope?: string | null;
}

export const SlidersAssetsButton: React.FC<SlidersAssetsButtonProps> = props => {
	const {hotkeyScope = 'global'} = props;
	const handleClick = useOpenSlidersAssets();
	const {t} = useTranslation();

	// Global, and allowed in text fields: the key is `alt+a`, which types nothing, and it
	// has to work from the map, the passage text, and every dialog alike.

	useCommand({
		allowInInput: true,
		id: 'sliders.assets',
		label: t('hotkeys.commands.sliders.assets'),
		run: handleClick,
		scope: hotkeyScope
	});

	return (
		<IconButton
			commandId="sliders.assets"
			icon={<IconPhoto />}
			label={t('routes.storyEdit.toolbar.slidersAssets')}
			onClick={handleClick}
		/>
	);
};
