import {IconPhoto} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../../components/control/icon-button';
import {SlidersAssetsDialog, useDialogsContext} from '../../../../dialogs';
import {useCommand} from '../../../../hotkeys';

/**
 * Opens the asset manager. A hook rather than a handler inside the button, because the
 * passage editor binds the same action to a key whether or not its toolbar--and so this
 * button--is on screen. See `PassageEditContents`.
 */
export function useOpenSlidersAssets() {
	const {dispatch} = useDialogsContext();

	return React.useCallback(
		() => dispatch({type: 'addDialog', component: SlidersAssetsDialog}),
		[dispatch]
	);
}

export interface SlidersAssetsButtonProps {
	/**
	 * Command this button answers to. The passage editor shows a second copy under its
	 * own ID so that the two can carry different keys--see `ScenePreviewButton`.
	 */
	commandId?: string;
	/**
	 * Scope the shortcut registers in, or null to register nothing--the passage editor's
	 * copy passes null, because the editor itself owns that registration. The button
	 * still shows the key: the chip reads the keymap, not the registration.
	 */
	hotkeyScope?: string | null;
}

export const SlidersAssetsButton: React.FC<SlidersAssetsButtonProps> = props => {
	const {commandId = 'sliders.assets', hotkeyScope = 'story-map'} = props;
	const handleClick = useOpenSlidersAssets();
	const {t} = useTranslation();

	useCommand({
		id: commandId,
		label: t(`hotkeys.commands.${commandId}`),
		run: handleClick,
		scope: hotkeyScope
	});

	return (
		<IconButton
			commandId={commandId}
			icon={<IconPhoto />}
			label={t('routes.storyEdit.toolbar.slidersAssets')}
			onClick={handleClick}
		/>
	);
};
