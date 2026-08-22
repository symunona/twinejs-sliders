import {IconCloudOff} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ConfirmButton} from '../../../../components/control/confirm-button';
import {Story} from '../../../../store/stories';
import {TestId} from './test-id';

export interface RemoveFromServerButtonProps {
	/** Set when the server has never heard of this story. */
	disabled?: boolean;
	onRemoveFromServer: (story: Story) => Promise<unknown> | unknown;
	story?: Story;
}

export const RemoveFromServerButton: React.FC<
	RemoveFromServerButtonProps
> = props => {
	const {disabled, onRemoveFromServer, story} = props;
	const {t} = useTranslation();

	return (
		<TestId testId="story-remove-from-server">
			<ConfirmButton
				confirmIcon={<IconCloudOff />}
				confirmLabel={t('routes.storyList.server.removeFromServer')}
				confirmVariant="danger"
				disabled={!story || disabled}
				icon={<IconCloudOff />}
				label={t('routes.storyList.server.removeFromServer')}
				onConfirm={() => story && void onRemoveFromServer(story)}
				prompt={t('routes.storyList.server.removeFromServerWarning', {
					storyName: story?.name
				})}
			/>
		</TestId>
	);
};
