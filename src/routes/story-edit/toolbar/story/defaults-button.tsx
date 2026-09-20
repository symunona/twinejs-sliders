import {IconAdjustments} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../../components/control/icon-button';
import {useCommand} from '../../../../hotkeys';
import {StoryDefaultsDialog, useDialogsContext} from '../../../../dialogs';
import {Story} from '../../../../store/stories';

export interface DefaultsButtonProps {
	story: Story;
}

export const DefaultsButton: React.FC<DefaultsButtonProps> = props => {
	const {story} = props;
	const {dispatch} = useDialogsContext();
	const {t} = useTranslation();

	const handleClick = React.useCallback(
		() =>
			dispatch({
				type: 'addDialog',
				component: StoryDefaultsDialog,
				props: {storyId: story.id}
			}),
		[dispatch, story.id]
	);

	useCommand({
		id: 'story.defaults',
		label: t('hotkeys.commands.story.defaults'),
		run: handleClick,
		scope: 'story-map'
	});

	return (
		<IconButton
			commandId="story.defaults"
			icon={<IconAdjustments />}
			label={t('common.defaults')}
			onClick={handleClick}
		/>
	);
};
