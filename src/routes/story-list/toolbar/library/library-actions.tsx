import {IconRefresh} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../../../components/container/button-bar';
import {IconButton} from '../../../../components/control/icon-button';
import {useServerSyncContext} from '../../../../store/persistence/server';
import {ArchiveButton} from './archive-button';
import {ImportStoryButton} from './import-story-button';
import {StoryTagsButton} from './story-tags-button';

/**
 * Pulls the server index by hand. The socket and the polling fallback both do this on
 * their own; this is for the moment someone knows a colleague just published.
 */
const RefreshServerButton: React.FC = () => {
	const {actions, connected} = useServerSyncContext();
	const ref = React.useRef<HTMLSpanElement>(null);
	const {t} = useTranslation();

	React.useEffect(() => {
		ref.current
			?.querySelector('button')
			?.setAttribute('data-testid', 'library-refresh-server');
	});

	return (
		<span ref={ref}>
			<IconButton
				disabled={!connected}
				icon={<IconRefresh />}
				label={t('routes.storyList.server.refresh')}
				onClick={() => void actions.refresh()}
			/>
		</span>
	);
};

export const LibraryActions: React.FC = () => (
	<ButtonBar>
		<StoryTagsButton />
		<ImportStoryButton />
		<ArchiveButton />
		<RefreshServerButton />
	</ButtonBar>
);
