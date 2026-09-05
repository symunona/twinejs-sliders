import {IconCheck} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {useServerSyncContext} from '../store/persistence/server/use-server-sync';
import {useStoriesContext} from '../store/stories';
import './sync-status-badge.css';

const timeFormatter = new Intl.DateTimeFormat([], {
	hour: '2-digit',
	minute: '2-digit'
});

/**
 * Small grey readout next to the "Twine" tab: when it last synced, and a checkmark only
 * when every synced story is fully caught up (no dirty/error/in-flight record). Renders
 * nothing when no story is marked for sync at all.
 */
export const SyncStatusBadge: React.FC = () => {
	const {records} = useServerSyncContext();
	const {stories} = useStoriesContext();
	const {t} = useTranslation();

	const syncedStories = stories.filter(story => story.sync === true);

	if (syncedStories.length === 0) {
		return null;
	}

	// A synced story with no record yet (just toggled on) counts as idle/never-synced,
	// not as "missing"--it still belongs in the up-to-date and last-sync calculations.
	const syncedRecords = syncedStories.map(story => records[story.id]);
	const upToDate = syncedRecords.every(
		record => (record?.state ?? 'idle') === 'idle'
	);
	const lastSync = syncedRecords.reduce(
		(latest, record) =>
			Math.max(latest, record?.lastPushedAt ?? 0, record?.lastPulledAt ?? 0),
		0
	);
	const label = lastSync
		? t('routeActions.app.syncStatus', {time: timeFormatter.format(lastSync)})
		: t('routeActions.app.syncStatusPending');

	return (
		<span
			className="sync-status-badge"
			data-testid="sync-status-badge"
			title={label}
		>
			{label}
			{upToDate && <IconCheck className="sync-status-badge-tick" />}
		</span>
	);
};
