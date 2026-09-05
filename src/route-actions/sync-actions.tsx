import {
	IconAlertTriangle,
	IconCheck,
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
import {Story, useStoriesContext} from '../store/stories';
import './sync-actions.css';

const timeFormatter = new Intl.DateTimeFormat([], {
	hour: '2-digit',
	minute: '2-digit'
});

export interface SyncActionsProps {
	/** The story Publish/Unpublish acts on. Omitted when none is unambiguously selected. */
	story?: Story;
}

export const SyncActions: React.FC<SyncActionsProps> = props => {
	const {story} = props;
	const {dispatch} = useDialogsContext();
	const {actions, client, connected, lastError, records} =
		useServerSyncContext();
	const {stories} = useStoriesContext();
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

	// A synced story with no record yet (just toggled on) counts as
	// idle/never-synced, not as missing--it still belongs in the up-to-date
	// and last-sync calculations.
	const syncedStories = stories.filter(s => s.sync === true);
	const syncedRecords = syncedStories.map(s => records[s.id]);
	const upToDate =
		syncedStories.length > 0 &&
		syncedRecords.every(record => (record?.state ?? 'idle') === 'idle');
	const lastSync = syncedRecords.reduce(
		(latest, record) =>
			Math.max(latest, record?.lastPushedAt ?? 0, record?.lastPulledAt ?? 0),
		0
	);
	const timeLabel = lastSync
		? t('routeActions.app.syncStatus', {time: timeFormatter.format(lastSync)})
		: t('routeActions.app.syncStatusPending');

	const statusDisplayLabel =
		syncedStories.length > 0 ? (
			<span className="sync-actions-status-label" data-testid="sync-status-badge">
				{upToDate && (
					<IconCheck className="sync-actions-status-tick" />
				)}
				<span className="sync-actions-status-time">{timeLabel}</span>
			</span>
		) : undefined;

	return (
		<ButtonBar>
			<IconButton
				disabled
				displayLabel={statusDisplayLabel}
				icon={statusIcon}
				label={statusLabel}
			/>
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
