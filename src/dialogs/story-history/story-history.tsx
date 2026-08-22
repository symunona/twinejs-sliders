/**
 * Version history for a story kept on the backup server (spec 11, "Versioning").
 *
 * One list, newest first, and a Restore button per row. No diffing, no branching, no
 * labels: restore is an ordinary server-side write, so the version being replaced becomes
 * a snapshot of its own and nothing here can destroy anything.
 */

import {IconAlertTriangle, IconCheck, IconHistory, IconX} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../components/container/button-bar';
import {CardContent} from '../../components/container/card';
import {DialogCard} from '../../components/container/dialog-card';
import {IconButton} from '../../components/control/icon-button';
import {useServerSyncContext} from '../../store/persistence/server';
import type {
	RevisionEntry,
	RevisionsResponse
} from '../../store/persistence/server/server.types';
import {DialogComponentProps} from '../dialogs.types';
import './story-history.css';

const dateFormatter = new Intl.DateTimeFormat([], {
	dateStyle: 'medium',
	timeStyle: 'short'
});

function formatDate(value: string): string {
	const date = new Date(value);

	return isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}

	if (bytes < 1024 * 1024) {
		return `${Math.round(bytes / 1024)} KB`;
	}

	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * A message kept as a key plus its values rather than as translated text: `t` is not a
 * stable identity between renders, and a loader that depended on it would reload itself
 * forever.
 */
interface Message {
	key: string;
	values?: Record<string, unknown>;
}

/**
 * Stamps a `data-testid` onto the button inside a shared control that doesn't take
 * arbitrary DOM props--cheaper than widening `IconButton` for one dialog.
 */
const TestId: React.FC<{testId: string}> = ({children, testId}) => {
	const ref = React.useRef<HTMLSpanElement>(null);

	React.useEffect(() => {
		ref.current?.querySelector('button')?.setAttribute('data-testid', testId);
	});

	return (
		<span className="story-history-test-id" ref={ref}>
			{children}
		</span>
	);
};

export interface StoryHistoryDialogProps extends DialogComponentProps {
	storyId: string;
}

export const StoryHistoryDialog: React.FC<StoryHistoryDialogProps> = props => {
	const {storyId, ...other} = props;
	const {client} = useServerSyncContext();
	const {t} = useTranslation();
	const [confirming, setConfirming] = React.useState<number | null>(null);
	const [error, setError] = React.useState<Message | null>(null);
	const [loading, setLoading] = React.useState(true);
	const [missingAssets, setMissingAssets] = React.useState<string[]>([]);
	const [restoring, setRestoring] = React.useState(false);
	const [response, setResponse] = React.useState<RevisionsResponse | null>(
		null
	);

	const load = React.useCallback(async () => {
		if (!client) {
			setLoading(false);
			setError({key: 'dialogs.storyHistory.noServer'});
			return null;
		}

		setLoading(true);

		try {
			const result = await client.listRevisions(storyId);

			setResponse(result);
			setError(null);
			return result;
		} catch (loadError) {
			setError({
				key: 'dialogs.storyHistory.error',
				values: {message: errorMessage(loadError)}
			});
			return null;
		} finally {
			setLoading(false);
		}
	}, [client, storyId]);

	React.useEffect(() => {
		void load();
	}, [load]);

	async function handleRestore(rev: number) {
		if (!client) {
			return;
		}

		setConfirming(null);
		setRestoring(true);

		try {
			const result = await client.restoreRevision(storyId, rev);

			setError(null);
			setMissingAssets(result.missingAssets ?? []);
			await load();

			// A story that came back without its art needs the user to read why, so the
			// dialog only closes itself when there is nothing to say.

			if ((result.missingAssets ?? []).length === 0) {
				props.onClose();
			}
		} catch (restoreError) {
			setError({
				key: 'dialogs.storyHistory.restoreError',
				values: {message: errorMessage(restoreError)}
			});
		} finally {
			setRestoring(false);
		}
	}

	const revisions: RevisionEntry[] = [...(response?.revisions ?? [])].sort(
		(a, b) => b.rev - a.rev
	);

	function renderRow(revision: RevisionEntry) {
		const current = revision.rev === response?.current;
		const when = formatDate(revision.at);

		return (
			<li
				className="story-history-row"
				data-rev={revision.rev}
				data-testid="story-history-row"
				key={revision.rev}
			>
				<div className="story-history-summary">
					<span className="story-history-when">{when}</span>
					{current && (
						<span className="story-history-now">
							{t('dialogs.storyHistory.now')}
						</span>
					)}
					<span className="story-history-who">
						{t('dialogs.storyHistory.savedBy', {client: revision.client})}
					</span>
					<span className="story-history-detail">
						{t('dialogs.storyHistory.passageCount', {
							count: revision.passages
						})}
					</span>
					<span className="story-history-detail">
						{formatBytes(revision.bytes)}
					</span>
					{revision.restoredFrom !== undefined && (
						<span className="story-history-detail">
							{t('dialogs.storyHistory.restoredFrom', {
								rev: revision.restoredFrom
							})}
						</span>
					)}
				</div>
				{!current &&
					(confirming === revision.rev ? (
						<div className="story-history-confirm">
							<p>
								{t('dialogs.storyHistory.restoreConfirm', {
									client: revision.client,
									date: when
								})}
							</p>
							<ButtonBar>
								<TestId testId="story-history-confirm">
									<IconButton
										disabled={restoring}
										icon={<IconCheck />}
										label={t('dialogs.storyHistory.restore')}
										onClick={() => handleRestore(revision.rev)}
										variant="primary"
									/>
								</TestId>
								<IconButton
									icon={<IconX />}
									label={t('common.cancel')}
									onClick={() => setConfirming(null)}
								/>
							</ButtonBar>
						</div>
					) : (
						<TestId testId="story-history-restore">
							<IconButton
								disabled={restoring}
								icon={<IconHistory />}
								label={t('dialogs.storyHistory.restore')}
								onClick={() => setConfirming(revision.rev)}
							/>
						</TestId>
					))}
			</li>
		);
	}

	return (
		<DialogCard
			{...other}
			className="story-history-dialog"
			fixedSize
			headerLabel={t('dialogs.storyHistory.title')}
		>
			<CardContent>
				{error && (
					<p className="story-history-error">
						<IconAlertTriangle /> {t(error.key, error.values)}
					</p>
				)}
				{missingAssets.length > 0 && (
					<p
						className="story-history-missing"
						data-testid="story-history-missing-assets"
					>
						<IconAlertTriangle />{' '}
						{t('dialogs.storyHistory.missingAssets', {
							count: missingAssets.length
						})}
					</p>
				)}
				{loading && <p>{t('dialogs.storyHistory.loading')}</p>}
				{restoring && <p>{t('dialogs.storyHistory.restoring')}</p>}
				{!loading && !error && revisions.length === 0 && (
					<p data-testid="story-history-empty">
						{t('dialogs.storyHistory.empty')}
					</p>
				)}
				{revisions.length > 0 && (
					<ul className="story-history-list">{revisions.map(renderRow)}</ul>
				)}
			</CardContent>
		</DialogCard>
	);
};
