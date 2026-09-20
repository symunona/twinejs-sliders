import {
	IconAlertTriangle,
	IconCheck,
	IconCloud,
	IconCloudDownload,
	IconCloudOff
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../components/control/icon-button';
import {ServerConflictDialog, useDialogsContext} from '../dialogs';
import type {SyncRecord} from '../store/persistence/server/server.types';
import {
	type SyncProgress,
	useServerSyncContext
} from '../store/persistence/server/use-server-sync';
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

/**
 * Art coming DOWN, either half of it: a checkout's `assets` phase and a later top-up's
 * `download` phase, i.e. `AssetDownloadProgress` in `checkout-story.ts`. The other
 * phases are not art arriving--`story` is the text, and `scan`/`diff`/`upload`/
 * `manifest` are a push, where the pictures are already here and nothing waits on them.
 *
 * Checkout is counted even though the story card already blocks and says so: the card
 * is on the story list, and this header also renders in the story EDITOR, where a
 * checkout fired from the other route is otherwise the app going quietly busy with no
 * word anywhere the author can see.
 */
function artDownload(
	progress: SyncProgress | undefined
): {done: number; total: number} | undefined {
	return progress?.phase === 'assets' || progress?.phase === 'download'
		? {done: progress.done, total: progress.total}
		: undefined;
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
	const {client, connected, lastError, progress, records} =
		useServerSyncContext();
	const {stories} = useStoriesContext();
	const {dispatch} = useDialogsContext();
	const {t} = useTranslation();

	const configured = client !== undefined;
	const ok = configured && connected;
	const record = story ? records[story.id] : undefined;
	const trouble = story ? troubleOf(record) : undefined;

	// Counted over the WHOLE progress map, never just `story`: this header is global--it
	// renders in the leading controls of both toolbars--and a download is a library-wide
	// "the app is busy", not a fact about one story. One number for however many stories
	// are downloading; the names go in the tooltip, which is the only place with room.
	const downloading = React.useMemo(() => {
		let any = false;
		let done = 0;
		let total = 0;
		const names: string[] = [];

		for (const [storyId, value] of Object.entries(progress ?? {})) {
			const art = artDownload(value);

			if (!art) {
				continue;
			}

			any = true;
			done += art.done;
			total += art.total;

			// A checkout writes the story before its art, so by the `assets` phase there
			// is a local name to read. Nameless is still counted--the number is the point.
			const name = stories.find(s => s.id === storyId)?.name;

			if (name) {
				names.push(name);
			}
		}

		return any ? {done, names, total} : undefined;
	}, [progress, stories]);

	// `gone` has no answer here: the story is off the server and coming back is a
	// republish, which only the story list offers. The other two are both "your copy
	// and theirs disagree", which is exactly what the conflict dialog is for--and
	// `resolveKeepMine` re-reads the rev before it pushes, so it unsticks a stale-rev
	// error as well as a real conflict.
	const resolvable = trouble === 'conflict' || trouble === 'error';

	const statusIcon =
		ok && !trouble ? (
			downloading ? (
				<IconCloudDownload />
			) : (
				<IconCloud />
			)
		) : (
			<span className="sync-actions-icon">
				<IconCloudOff />
				{(configured || trouble) && (
					<IconAlertTriangle className="sync-actions-alert" />
				)}
			</span>
		);

	let statusLabel: string;
	let hint: string | undefined;

	switch (trouble) {
		case 'conflict':
			statusLabel = t('routeActions.app.syncConflict');
			hint = t('routeActions.app.syncConflictHint', {
				storyName: story?.name
			});
			break;
		case 'error':
			statusLabel = t('routeActions.app.syncFailed');
			hint = record?.lastError
				? t('routeActions.app.syncFailedHintDetail', {
						message: record.lastError,
						storyName: story?.name
					})
				: t('routeActions.app.syncFailedHint', {storyName: story?.name});
			break;
		case 'gone':
			statusLabel = t('routeActions.app.syncGone');
			hint = t('routeActions.app.syncGoneHint', {
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

	// Trouble still wins: it is stuck until the author acts, a download clears itself.
	// A count of zero out of zero is a download that has not sized itself yet--say that
	// it is happening rather than "0 of 0", which reads as finished.
	if (!trouble && downloading) {
		statusLabel =
			downloading.total > 0
				? t('routeActions.app.syncDownloadingCount', {
						done: downloading.done,
						total: downloading.total
					})
				: t('routeActions.app.syncDownloading');
		hint =
			downloading.names.length > 0
				? t('routeActions.app.syncDownloadingHint', {
						storyNames: downloading.names.join(', ')
					})
				: undefined;
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
	) : downloading ? (
		<span
			className="sync-actions-status-label"
			data-testid="sync-status-downloading"
		>
			{/* No glyph in the badge: the button's own icon is already the download
			    cloud, and the same picture twice two pixels apart is noise. The tick
			    on the idle badge has no such twin. */}
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
			tooltipLabel={hint}
			variant={trouble ? 'danger' : 'secondary'}
		/>
	);
};
