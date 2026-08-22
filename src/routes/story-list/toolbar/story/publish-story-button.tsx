import {IconCloudUpload} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../../../components/container/button-bar';
import {CardContent} from '../../../../components/container/card';
import {CardButton} from '../../../../components/control/card-button';
import {IconButton} from '../../../../components/control/icon-button';
import {Story} from '../../../../store/stories';
import {isConflictError, TestId} from './test-id';

export interface PublishStoryButtonProps {
	/**
	 * True when the server index already lists this story's ID. Publishing then has to ask
	 * whether the person means to overwrite it or wants a new document.
	 */
	existsOnServer?: boolean;
	onPublish: (
		story: Story,
		options?: {newIdentity?: boolean}
	) => Promise<unknown> | unknown;
	story?: Story;
}

export const PublishStoryButton: React.FC<PublishStoryButtonProps> = props => {
	const {existsOnServer, onPublish, story} = props;
	const [busy, setBusy] = React.useState(false);
	const [conflictOpen, setConflictOpen] = React.useState(false);
	const {t} = useTranslation();

	async function publish(options?: {newIdentity?: boolean}) {
		if (!story) {
			return;
		}

		setBusy(true);

		try {
			await onPublish(story, options);
			setConflictOpen(false);
		} catch (error) {
			// The server already has this ID. Overwriting and publishing as a new story are
			// both reasonable and only the person can say which.

			if (isConflictError(error) && !options) {
				setConflictOpen(true);
			} else {
				setConflictOpen(false);
				throw error;
			}
		} finally {
			setBusy(false);
		}
	}

	// The card's trigger is the Publish button itself: clicking it publishes, and the card
	// only appears when the publish came back conflicted.

	function handleChangeOpen(value: boolean) {
		if (!value) {
			setConflictOpen(false);
		} else if (existsOnServer) {
			setConflictOpen(true);
		} else {
			void publish();
		}
	}

	return (
		<TestId testId="story-publish">
			<CardButton
				ariaLabel={t('routes.storyList.server.publishConflict', {
					storyName: story?.name
				})}
				disabled={!story || busy}
				icon={<IconCloudUpload />}
				label={t('routes.storyList.server.publish')}
				onChangeOpen={handleChangeOpen}
				open={conflictOpen}
			>
				<div>
					<CardContent>
						{t('routes.storyList.server.publishConflict', {
							storyName: story?.name
						})}
					</CardContent>
					<ButtonBar>
						<IconButton
							icon={<IconCloudUpload />}
							label={t('routes.storyList.server.publishOverwrite')}
							onClick={() => void publish({newIdentity: false})}
							variant="danger"
						/>
						<IconButton
							icon={<IconCloudUpload />}
							label={t('routes.storyList.server.publishAsNew')}
							onClick={() => void publish({newIdentity: true})}
							variant="primary"
						/>
					</ButtonBar>
				</div>
			</CardButton>
		</TestId>
	);
};
