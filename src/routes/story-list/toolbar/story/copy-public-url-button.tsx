import {IconCheck, IconLink} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../../components/control/icon-button';
import {publicStoryUrl} from '../../../../store/persistence/server';
import {usePrefsContext} from '../../../../store/prefs';
import {Story} from '../../../../store/stories';
import {copyText} from '../../../../util/copy-text';
import {TestId} from './test-id';

export interface CopyPublicUrlButtonProps {
	/** The link only answers once the server has the story. */
	existsOnServer: boolean;
	story?: Story;
}

export const CopyPublicUrlButton: React.FC<
	CopyPublicUrlButtonProps
> = props => {
	const {existsOnServer, story} = props;
	const {prefs} = usePrefsContext();
	const [copied, setCopied] = React.useState(false);
	const {t} = useTranslation();

	React.useEffect(() => {
		if (!copied) {
			return;
		}

		const timeout = window.setTimeout(() => setCopied(false), 1500);

		return () => window.clearTimeout(timeout);
	}, [copied]);

	async function handleClick() {
		if (story && prefs.backendUrl) {
			setCopied(await copyText(publicStoryUrl(prefs.backendUrl, story.id)));
		}
	}

	return (
		<TestId testId="story-copy-public-url">
			<IconButton
				disabled={!story || !prefs.backendUrl || !existsOnServer}
				icon={copied ? <IconCheck /> : <IconLink />}
				label={t(
					copied
						? 'routes.storyList.server.copyPublicUrlCopied'
						: 'routes.storyList.server.copyPublicUrl'
				)}
				onClick={handleClick}
			/>
		</TestId>
	);
};
