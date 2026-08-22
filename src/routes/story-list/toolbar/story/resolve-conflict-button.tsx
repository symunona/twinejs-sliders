import {IconAlertTriangle} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../../components/control/icon-button';
import {ServerConflictDialog, useDialogsContext} from '../../../../dialogs';
import {Story} from '../../../../store/stories';
import {TestId} from './test-id';

export interface ResolveConflictButtonProps {
	story?: Story;
}

export const ResolveConflictButton: React.FC<
	ResolveConflictButtonProps
> = props => {
	const {story} = props;
	const {dispatch} = useDialogsContext();
	const {t} = useTranslation();

	return (
		<TestId testId="story-resolve">
			<IconButton
				disabled={!story}
				icon={<IconAlertTriangle />}
				label={t('routes.storyList.server.resolve')}
				onClick={() =>
					story &&
					dispatch({
						type: 'addDialog',
						component: ServerConflictDialog,
						props: {storyId: story.id}
					})
				}
				variant="danger"
			/>
		</TestId>
	);
};
