import {
	IconAlertTriangle,
	IconCheck,
	IconLink,
	IconLoader
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../../components/control/icon-button';
import {
	publicBlobUrl,
	publicStoryUrl,
	ServerClient
} from '../../../../store/persistence/server';
import {usePrefsContext} from '../../../../store/prefs';
import {Story} from '../../../../store/stories';
import {usePublishing} from '../../../../store/use-publishing';
import {copyText} from '../../../../util/copy-text';
import {TestId} from './test-id';

export interface CopyPublicUrlButtonProps {
	client?: ServerClient;
	/** The link only answers once the server has the story. */
	existsOnServer: boolean;
	story?: Story;
}

type Status = 'idle' | 'publishing' | 'copied' | 'failed';

const icons: Record<Status, React.ReactNode> = {
	copied: <IconCheck />,
	failed: <IconAlertTriangle />,
	idle: <IconLink />,
	publishing: <IconLoader />
};

const labels: Record<Status, string> = {
	copied: 'routes.storyList.server.copyPublicUrlCopied',
	failed: 'routes.storyList.server.copyPublicUrlFailed',
	idle: 'routes.storyList.server.copyPublicUrl',
	publishing: 'routes.storyList.server.copyPublicUrlPublishing'
};

/**
 * Publishes the story as playable HTML to `GET /pub/{id}` and copies that link. The page
 * is a snapshot: it plays what the story was at the click, so clicking again republishes.
 */
export const CopyPublicUrlButton: React.FC<
	CopyPublicUrlButtonProps
> = props => {
	const {client, existsOnServer, story} = props;
	const {prefs} = usePrefsContext();
	const {publishStory} = usePublishing();
	const [status, setStatus] = React.useState<Status>('idle');
	const {t} = useTranslation();

	React.useEffect(() => {
		if (status !== 'copied' && status !== 'failed') {
			return;
		}

		const timeout = window.setTimeout(() => setStatus('idle'), 2500);

		return () => window.clearTimeout(timeout);
	}, [status]);

	async function handleClick() {
		if (!story || !client || !prefs.backendUrl) {
			return;
		}

		const backendUrl = prefs.backendUrl;

		// Copied before publishing: the clipboard wants the click's user activation, and
		// building the page can outlast it.
		const copied = copyText(publicStoryUrl(backendUrl, story.id));

		setStatus('publishing');

		try {
			const html = await publishStory(story.id, {
				slidersUrls: {remote: hash => publicBlobUrl(backendUrl, hash)}
			});

			await client.putPlayer(story.id, html);
			setStatus((await copied) ? 'copied' : 'failed');
		} catch (error) {
			console.warn('Could not publish the public player', error);
			setStatus('failed');
		}
	}

	return (
		<TestId testId="story-copy-public-url">
			<IconButton
				disabled={
					!story ||
					!client ||
					!prefs.backendUrl ||
					!existsOnServer ||
					status === 'publishing'
				}
				icon={icons[status]}
				label={t(labels[status])}
				onClick={handleClick}
			/>
		</TestId>
	);
};
