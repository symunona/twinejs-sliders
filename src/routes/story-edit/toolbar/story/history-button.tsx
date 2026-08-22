import {IconHistory} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../../components/control/icon-button';
import {StoryHistoryDialog, useDialogsContext} from '../../../../dialogs';
import {Story} from '../../../../store/stories';

export interface HistoryButtonProps {
	story: Story;
}

export const HistoryButton: React.FC<HistoryButtonProps> = props => {
	const {story} = props;
	const {dispatch} = useDialogsContext();
	const {t} = useTranslation();

	const handleClick = React.useCallback(
		() =>
			dispatch({
				type: 'addDialog',
				component: StoryHistoryDialog,
				props: {storyId: story.id}
			}),
		[dispatch, story.id]
	);

	return (
		<IconButton
			icon={<IconHistory />}
			label={t('dialogs.storyHistory.buttonLabel')}
			onClick={handleClick}
		/>
	);
};
