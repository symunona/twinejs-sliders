/**
 * Version history for a story kept on the backup server (spec 11, "Versioning").
 *
 * One list, newest first, and a Restore button per row. No diffing, no branching: restore
 * is an ordinary server-side write, so the version being replaced becomes a snapshot of
 * its own and nothing here can destroy anything.
 *
 * # What a row says, and in what order
 *
 * `10:12  mira  Tavern Night +2 more   14 passages  82 KB`. The middle of that is the only
 * interesting part, and it has three sources, in this order:
 *
 *   1. `label` — a human typed it. Always wins; that is what typing it was for.
 *   2. `summary` — the client that made the write derived it from the patch
 *      (`patch-summary.ts`). Words for an autosave that had none.
 *   3. nothing — an old revision, written before either existed. The row then reads the
 *      way it always did, and does not apologise for it.
 *
 * Both are optional on the wire and absent means empty, so every row reachable here still
 * renders whatever it can.
 *
 * # Labelling is not a write of the story
 *
 * `setRevisionMeta` bumps no rev, takes no `If-Match` and gets no ETag back
 * (`server/api/revisions.go`). So a failure here is never a lost race and must never reach
 * the conflict path — including the one failure worth reading, `PINNED_MAX`, which comes
 * back as a plain 400 whose MESSAGE is the whole point. It is shown verbatim rather than
 * folded into a sentence of ours, because only the server knows the number.
 *
 * The current version is labelable and pinnable like any other row. It has no entry in
 * `revs/index.json` yet, so the server parks its label and pin on `meta.json` and moves
 * them onto the row the moment that version is replaced. Voice mode's `checkpoint(label)`
 * is exactly that call.
 */

import {
	IconAlertTriangle,
	IconCheck,
	IconHistory,
	IconPencil,
	IconPin,
	IconX
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../components/container/button-bar';
import {CardContent} from '../../components/container/card';
import {DialogCard} from '../../components/container/dialog-card';
import {IconButton} from '../../components/control/icon-button';
import {TextInput} from '../../components/control/text-input';
import {useServerSyncContext} from '../../store/persistence/server';
import {onRevisionMeta} from '../../store/persistence/server/server-message';
import {noteSyncReason} from '../../store/persistence/server/sync-reason';
import type {
	RevisionEntry,
	RevisionMetaResponse,
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
	/**
	 * The server's own sentence, drawn verbatim after the translated lead-in instead of
	 * interpolated into it.
	 *
	 * Only `PINNED_MAX` uses this, and it is why: "you already have 50 pinned versions,
	 * unpin one" is the entire useful content of that failure, and a sentence of ours
	 * wrapped around it can only make it longer. The other two errors here still
	 * interpolate, because the messages they carry are network noise.
	 */
	detail?: string;
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
	const [draft, setDraft] = React.useState('');
	const [editing, setEditing] = React.useState<number | null>(null);
	const [error, setError] = React.useState<Message | null>(null);
	const [loading, setLoading] = React.useState(true);
	const [missingAssets, setMissingAssets] = React.useState<string[]>([]);
	const [restoring, setRestoring] = React.useState(false);
	const [saving, setSaving] = React.useState(false);
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

	// Somebody else labelled or pinned a version of this story. The list is small and the
	// message carries no content, so the answer is to ask again rather than to guess what
	// one row now says -- and re-listing is also how a row that was pruned out from under
	// us disappears.
	React.useEffect(
		() =>
			onRevisionMeta(id => {
				if (id === storyId) {
					void load();
				}
			}),
		[load, storyId]
	);

	async function handleRestore(rev: number) {
		if (!client) {
			return;
		}

		setConfirming(null);
		setRestoring(true);

		// Before the call, not after: the restore lands as an ordinary server write, and
		// whatever this browser pushes next about this story should say what happened
		// rather than describe the bytes. An unconsumed note is harmless by design --
		// `sync-reason.ts` says so and says why.
		noteSyncReason(storyId, 'restore');

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

	/**
	 * Patch one row from what the call answered with, rather than re-listing.
	 *
	 * The response IS the row as it now stands, so a round trip would only buy a chance
	 * for the list to have moved under a label the author just typed.
	 */
	function applyMeta(result: RevisionMetaResponse) {
		setResponse(current =>
			current === null
				? current
				: {
						...current,
						revisions: current.revisions.map(revision =>
							revision.rev === result.rev
								? {
										...revision,
										label: result.label,
										pinned: result.pinned,
										summary: result.summary
								  }
								: revision
						)
				  }
		);
	}

	async function setMeta(rev: number, meta: {label?: string; pinned?: boolean}) {
		if (!client) {
			return;
		}

		setSaving(true);

		try {
			applyMeta(await client.setRevisionMeta(storyId, rev, meta));
			setError(null);
		} catch (metaError) {
			setError({
				detail: errorMessage(metaError),
				key: 'dialogs.storyHistory.metaError'
			});
		} finally {
			setSaving(false);
		}
	}

	function startEditing(revision: RevisionEntry) {
		setConfirming(null);
		setEditing(revision.rev);
		setDraft(revision.label ?? '');
	}

	async function submitLabel(rev: number) {
		setEditing(null);

		// Empty is a spelling, not a no-op: it clears the label and the row falls back to
		// the derived summary. The server reads `''` that way on purpose.
		await setMeta(rev, {label: draft.trim()});
	}

	const revisions: RevisionEntry[] = [...(response?.revisions ?? [])].sort(
		(a, b) => b.rev - a.rev
	);

	function renderRow(revision: RevisionEntry) {
		const current = revision.rev === response?.current;
		const when = formatDate(revision.at);
		const pinned = revision.pinned ?? false;
		const title = revision.label || revision.summary || '';

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
					{pinned && (
						<span
							className="story-history-pinned"
							data-testid="story-history-pinned"
						>
							<IconPin /> {t('dialogs.storyHistory.pinned')}
						</span>
					)}
					<span className="story-history-who">
						{t('dialogs.storyHistory.savedBy', {client: revision.client})}
					</span>
					{title && (
						<span
							className="story-history-title"
							data-testid="story-history-title"
						>
							{title}
						</span>
					)}
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
				{editing === revision.rev ? (
					<div className="story-history-edit">
						<TextInput
							onChange={event => setDraft(event.target.value)}
							onKeyDown={event => {
								if (event.key === 'Enter') {
									void submitLabel(revision.rev);
								} else if (event.key === 'Escape') {
									setEditing(null);
								}
							}}
							placeholder={t('dialogs.storyHistory.labelPlaceholder')}
							value={draft}
						>
							{t('dialogs.storyHistory.label')}
						</TextInput>
						<ButtonBar>
							<TestId testId="story-history-label-save">
								<IconButton
									disabled={saving}
									icon={<IconCheck />}
									label={t('dialogs.storyHistory.saveLabel')}
									onClick={() => void submitLabel(revision.rev)}
									variant="primary"
								/>
							</TestId>
							<IconButton
								icon={<IconX />}
								label={t('common.cancel')}
								onClick={() => setEditing(null)}
							/>
						</ButtonBar>
					</div>
				) : confirming === revision.rev ? (
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
					<ButtonBar>
						<TestId testId="story-history-label">
							<IconButton
								disabled={saving}
								icon={<IconPencil />}
								iconOnly
								label={t('dialogs.storyHistory.editLabel')}
								onClick={() => startEditing(revision)}
							/>
						</TestId>
						<TestId testId="story-history-pin">
							<IconButton
								disabled={saving}
								icon={<IconPin />}
								iconOnly
								label={t(
									pinned
										? 'dialogs.storyHistory.unpin'
										: 'dialogs.storyHistory.pin'
								)}
								onClick={() => void setMeta(revision.rev, {pinned: !pinned})}
								selectable
								selected={pinned}
							/>
						</TestId>
						{/* The current version is already the story; restoring it onto
						    itself would only cost a rev. Labelling and pinning it are
						    another matter -- see the file comment. */}
						{!current && (
							<TestId testId="story-history-restore">
								<IconButton
									disabled={restoring}
									icon={<IconHistory />}
									label={t('dialogs.storyHistory.restore')}
									onClick={() => setConfirming(revision.rev)}
								/>
							</TestId>
						)}
					</ButtonBar>
				)}
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
						{error.detail && (
							<span
								className="story-history-error-detail"
								data-testid="story-history-error-detail"
							>
								{error.detail}
							</span>
						)}
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
