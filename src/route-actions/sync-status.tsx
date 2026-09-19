import {
	IconAlertTriangle,
	IconCheck,
	IconCloud,
	IconCloudOff
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../components/control/icon-button';
import {ServerConflictDialog, useDialogsContext} from '../dialogs';
import type {SyncRecord} from '../store/persistence/server/server.types';
import {useServerSyncContext} from '../store/persistence/server/use-server-sync';
import {Story, useStoriesContext} from '../store/stories';
import './sync-actions.css';

const timeFormatter = new Intl.DateTimeFormat([], {
	hour: '2-digit',
	minute: '2-digit'
});

/**
 * States where a story has stopped syncing and stays stopped until the author says
 * what to do. Everything else in `SyncState` resolves itself: `dirty`, `pushing` and
 * `pulling` are work in progress, `idle` is done.
 */
type Trouble = 'conflict' | 'error' | 'gone';

function troubleOf(record: SyncRecord | undefined): Trouble | undefined {
	switch (record?.state) {
		case 'conflict':
		case 'error':
		case 'gone':
			return record.state;
		default:
			return undefined;
	}
}

export interface SyncStatusProps {
	/**
	 * The story the status is about. The editor has exactly one and an author there
	 * only cares about that one--a library-wide line has nowhere to say which story
	 * stopped syncing, which is how a conflict used to hide behind "Synced 10:12"
	 * while every later edit went nowhere. The story list passes nothing and keeps the
	 * library summary.
	 */
	story?: Story;
}

/**
 * Connection state and last sync time, shown in the toolbar's pinned controls so
 * that it is visible whichever tab is selected--the Sync tab's own buttons are a
 * click away, but whether sync is working is something an author needs at a
 * glance.
 */
export const SyncStatus: React.FC<SyncStatusProps> = props => {
	const {story} = props;
	const {client, connected, lastError, records} = useServerSyncContext();
	const {stories} = useStoriesContext();
	const {dispatch} = useDialogsContext();
	const {t} = useTranslation();

	const configured = client !== undefined;
	const ok = configured && connected;
	const record = story ? records[story.id] : undefined;
	const trouble = story ? troubleOf(record) : undefined;

	// `gone` has no answer here: the story is off the server and coming back is a
	// republish, which only the story list offers. The other two are both "your copy
	// and theirs disagree", which is exactly what the conflict dialog is for--and
	// `resolveKeepMine` re-reads the rev before it pushes, so it unsticks a stale-rev
	// error as well as a real conflict.
	const resolvable = trouble === 'conflict' || trouble === 'error';

	const statusIcon =
		ok && !trouble ? (
			<IconCloud />
		) : (
			<span className="sync-actions-icon">
				<IconCloudOff />
				{(configured || trouble) && (
					<IconAlertTriangle className="sync-actions-alert" />
				)}
			</span>
		);

	let statusLabel: string;
	let troubleHint: string | undefined;

	switch (trouble) {
		case 'conflict':
			statusLabel = t('routeActions.app.syncConflict');
			troubleHint = t('routeActions.app.syncConflictHint', {
				storyName: story?.name
			});
			break;
		case 'error':
			statusLabel = t('routeActions.app.syncFailed');
			troubleHint = record?.lastError
				? t('routeActions.app.syncFailedHintDetail', {
						message: record.lastError,
						storyName: story?.name
					})
				: t('routeActions.app.syncFailedHint', {storyName: story?.name});
			break;
		case 'gone':
			statusLabel = t('routeActions.app.syncGone');
			troubleHint = t('routeActions.app.syncGoneHint', {
				storyName: story?.name
			});
			break;
		default:
			statusLabel = ok
				? t('routeActions.app.sync')
				: configured
					? (lastError ?? t('routeActions.app.syncDisconnected'))
					: t('routeActions.app.syncNotConfigured');
	}

	// A synced story with no record yet (just toggled on) counts as
	// idle/never-synced, not as missing--it still belongs in the up-to-date
	// and last-sync calculations.
	const watched: (SyncRecord | undefined)[] = story
		? story.sync === true || record
			? [record]
			: []
		: stories.filter(s => s.sync === true).map(s => records[s.id]);
	const upToDate =
		watched.length > 0 &&
		watched.every(item => (item?.state ?? 'idle') === 'idle');
	const lastSync = watched.reduce(
		(latest, item) =>
			Math.max(latest, item?.lastPushedAt ?? 0, item?.lastPulledAt ?? 0),
		0
	);
	const timeLabel = lastSync
		? t('routeActions.app.syncStatus', {time: timeFormatter.format(lastSync)})
		: t('routeActions.app.syncStatusPending');

	// In trouble the time is a lie by omission: it is when syncing last worked, not
	// when this story last reached the server. Say what is wrong instead.
	const statusDisplayLabel = trouble ? (
		<span
			className="sync-actions-status-label"
			data-testid="sync-status-trouble"
		>
			<span className="sync-actions-status-time">{statusLabel}</span>
		</span>
	) : watched.length > 0 ? (
		<span className="sync-actions-status-label" data-testid="sync-status-badge">
			{upToDate && <IconCheck className="sync-actions-status-tick" />}
			<span className="sync-actions-status-time">{timeLabel}</span>
		</span>
	) : undefined;

	return (
		<IconButton
			disabled={!resolvable}
			displayLabel={statusDisplayLabel}
			icon={statusIcon}
			label={statusLabel}
			onClick={
				resolvable && story
					? () =>
							dispatch({
								type: 'addDialog',
								component: ServerConflictDialog,
								props: {storyId: story.id}
							})
					: undefined
			}
			tooltipLabel={troubleHint}
			variant={trouble ? 'danger' : 'secondary'}
		/>
	);
};
