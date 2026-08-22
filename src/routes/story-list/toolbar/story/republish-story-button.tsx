import {IconCloudUpload} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../../components/control/icon-button';
import {Story} from '../../../../store/stories';
import {TestId} from './test-id';

export interface RepublishStoryButtonProps {
	onRepublish: (story: Story) => Promise<unknown> | unknown;
	story?: Story;
}

export const RepublishStoryButton: React.FC<
	RepublishStoryButtonProps
> = props => {
	const {onRepublish, story} = props;
	const {t} = useTranslation();

	return (
		<TestId testId="story-republish">
			<IconButton
				disabled={!story}
				icon={<IconCloudUpload />}
				label={t('routes.storyList.server.republish')}
				onClick={() => story && void onRepublish(story)}
				variant="primary"
			/>
		</TestId>
	);
};
