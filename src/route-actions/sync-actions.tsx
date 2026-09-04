import {
	IconAlertTriangle,
	IconCloud,
	IconCloudOff,
	IconSettings
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../components/container/button-bar';
import {IconButton} from '../components/control/icon-button';
import {SyncPrefsDialog, useDialogsContext} from '../dialogs';
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
	const {actions, client, connected, lastError} = useServerSyncContext();
	const {t} = useTranslation();

	const configured = client !== undefined;
	const ok = configured && connected;

	const statusIcon = ok ? (
		<IconCloud />
	) : (
		<span className="sync-actions-icon">
			<IconCloudOff />
			{configured && <IconAlertTriangle className="sync-actions-alert" />}
		</span>
	);
	const statusLabel: string = ok
		? t('routeActions.app.sync')
		: configured
			? (lastError ?? t('routeActions.app.syncDisconnected'))
			: t('routeActions.app.syncNotConfigured');

	return (
		<ButtonBar>
			<IconButton disabled icon={statusIcon} label={statusLabel} />
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
