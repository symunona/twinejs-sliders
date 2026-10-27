import {IconCloud, IconCloudOff, IconSettings} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../components/container/button-bar';
import {IconButton} from '../components/control/icon-button';
import {SyncPrefsDialog, useDialogsContext} from '../dialogs';
import {CopyPublicUrlButton} from '../routes/story-list/toolbar/story/copy-public-url-button';
import {useServerSyncContext} from '../store/persistence/server/use-server-sync';
import {Story} from '../store/stories';
import './sync-actions.css';

export interface SyncActionsProps {
	/** The story Publish/Unpublish acts on. Omitted when none is unambiguously selected. */
	story?: Story;
}

export const SyncActions: React.FC<SyncActionsProps> = props => {
	const {story} = props;
	const {dispatch} = useDialogsContext();
	const {actions, client, index} = useServerSyncContext();
	const {t} = useTranslation();

	return (
		<ButtonBar>
			{story &&
				(story.sync === true ? (
					<IconButton
						icon={<IconCloudOff />}
						label={t('routeActions.app.syncUnpublish')}
						onClick={() => actions.setSync(story, false)}
					/>
				) : (
					<IconButton
						icon={<IconCloud />}
						label={t('routeActions.app.syncPublish')}
						onClick={() => actions.publish(story)}
					/>
				))}
			{story && (
				<CopyPublicUrlButton
					client={client}
					existsOnServer={index.some(entry => entry.id === story.id)}
					story={story}
				/>
			)}
			<IconButton
				icon={<IconSettings />}
				label={t('routeActions.app.syncSettings')}
				onClick={() =>
					dispatch({type: 'addDialog', component: SyncPrefsDialog})
				}
			/>
		</ButtonBar>
	);
};
