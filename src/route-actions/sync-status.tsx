import {
	IconAlertTriangle,
	IconCheck,
	IconCloud,
	IconCloudOff
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../components/control/icon-button';
import {useServerSyncContext} from '../store/persistence/server/use-server-sync';
import {useStoriesContext} from '../store/stories';
import './sync-actions.css';

const timeFormatter = new Intl.DateTimeFormat([], {
	hour: '2-digit',
	minute: '2-digit'
});

/**
 * Connection state and last sync time, shown in the toolbar's pinned controls so
 * that it is visible whichever tab is selected--the Sync tab's own buttons are a
 * click away, but whether sync is working is something an author needs at a
 * glance.
 */
export const SyncStatus: React.FC = () => {
	const {client, connected, lastError, records} = useServerSyncContext();
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
			<span
				className="sync-actions-status-label"
				data-testid="sync-status-badge"
			>
				{upToDate && <IconCheck className="sync-actions-status-tick" />}
				<span className="sync-actions-status-time">{timeLabel}</span>
			</span>
		) : undefined;

	return (
		<IconButton
			disabled
			displayLabel={statusDisplayLabel}
			icon={statusIcon}
			label={statusLabel}
		/>
	);
};
