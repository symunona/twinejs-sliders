import {IconMicrophone, IconMicrophoneOff} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/control/icon-button';
import {useDialogsContext} from '../../../dialogs';
import {VoiceModeDialog} from '../../../dialogs/voice-mode';
import {Story} from '../../../store/stories';
import {Point} from '../../../util/geometry';

export interface VoiceModeButtonProps {
	getCenter: () => Point;
	setCenter: (point: Point) => void;
	story: Story;
}

/**
 * The toggle, left of the zoom buttons (§2).
 *
 * Off means OFF: closing the panel is what closes the socket and stops the mic track, so
 * the hardware light goes out. There is no hot mic idling behind a collapsed dialog, which
 * is why this is a plain open/close rather than a mute.
 */
export const VoiceModeButton: React.FC<VoiceModeButtonProps> = props => {
	const {getCenter, setCenter, story} = props;
	const {dialogs, dispatch} = useDialogsContext();
	const openIndex = dialogs.findIndex(
		dialog => dialog.component === VoiceModeDialog
	);
	const open = openIndex !== -1;
	const {t} = useTranslation();

	const handleClick = React.useCallback(() => {
		if (open) {
			dispatch({type: 'removeDialog', index: openIndex});
			return;
		}

		dispatch({
			component: VoiceModeDialog,
			props: {getCenter, setCenter, storyId: story.id},
			type: 'addDialog'
		});
	}, [dispatch, getCenter, open, openIndex, setCenter, story.id]);

	return (
		<IconButton
			icon={open ? <IconMicrophone /> : <IconMicrophoneOff />}
			iconOnly
			label={t('routes.storyEdit.toolbar.voiceMode')}
			onClick={handleClick}
			selectable
			selected={open}
		/>
	);
};
