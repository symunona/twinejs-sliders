import {IconCloud, IconCloudOff} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {CheckboxButton} from '../../../../components/control/checkbox-button';
import {Story} from '../../../../store/stories';
import {TestId} from './test-id';

export interface SyncStoryButtonProps {
	onSetSync: (story: Story, value: boolean) => Promise<unknown> | unknown;
	story?: Story;
}

export const SyncStoryButton: React.FC<SyncStoryButtonProps> = props => {
	const {onSetSync, story} = props;
	const {t} = useTranslation();

	return (
		<TestId testId="story-sync-toggle">
			<CheckboxButton
				checkedIcon={<IconCloud />}
				disabled={!story}
				label={t('routes.storyList.server.syncToServer')}
				onChange={value => story && void onSetSync(story, value)}
				uncheckedIcon={<IconCloudOff />}
				value={story?.sync === true}
			/>
		</TestId>
	);
};
