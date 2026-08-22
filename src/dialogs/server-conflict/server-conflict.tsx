/**
 * Resolving a story that changed on the server while it was being edited here
 * (spec 11, "Conflicts").
 *
 * The server never merges and never loses a version, and this dialog exists to make that
 * visible: whichever button is pressed, both bodies still exist afterwards--one on the
 * server, one either in `revs/` or as a separate local copy.
 */

import {
	IconAlertTriangle,
	IconClock,
	IconDeviceDesktop,
	IconServer
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../components/container/button-bar';
import {CardContent} from '../../components/container/card';
import {DialogCard} from '../../components/container/dialog-card';
import {IconButton} from '../../components/control/icon-button';
import {useServerSyncContext} from '../../store/persistence/server';
import {Story, storyWithId, useStoriesContext} from '../../store/stories';
import {DialogComponentProps} from '../dialogs.types';
import './server-conflict.css';

const dateFormatter = new Intl.DateTimeFormat([], {
	dateStyle: 'medium',
	timeStyle: 'short'
});

function formatDate(value: Date | string | number | undefined): string {
	if (value === undefined) {
		return '';
	}

	const date = value instanceof Date ? value : new Date(value);

	return isNaN(date.getTime()) ? String(value) : dateFormatter.format(date);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * A message kept as a key plus its values rather than as translated text: `t` is not a
 * stable identity between renders, and a loader that depended on it would refetch forever.
 */
interface Message {
	key: string;
	values?: Record<string, unknown>;
}

/**
 * `getStory()` answers an envelope carrying the rev its ETag held, or the not-modified
 * sentinel when nothing changed. Only the body matters here, and a sentinel means the
 * server has nothing new to show.
 */
function storyFromFetch(value: unknown): Story | null {
	if (typeof value === 'string' || !value) {
		return null;
	}

	const envelope = value as {story?: Story};

	return (envelope.story ?? value) as Story;
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
		<span className="server-conflict-test-id" ref={ref}>
			{children}
		</span>
	);
};

export interface ServerConflictDialogProps extends DialogComponentProps {
	storyId: string;
}

export const ServerConflictDialog: React.FC<
	ServerConflictDialogProps
> = props => {
	const {storyId, ...other} = props;
	const {actions, client, records} = useServerSyncContext();
	const {stories} = useStoriesContext();
	const {t} = useTranslation();
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<Message | null>(null);
	const [loading, setLoading] = React.useState(true);
	const [serverStory, setServerStory] = React.useState<Story | null>(null);

	const localStory = storyWithId(stories, storyId);
	const record = records[storyId];

	React.useEffect(() => {
		let cancelled = false;

		async function load() {
			if (!client) {
				setLoading(false);
				setError({key: 'dialogs.serverConflict.noServer'});
				return;
			}

			try {
				const result = await client.getStory(storyId);

				if (!cancelled) {
					setServerStory(storyFromFetch(result));
				}
			} catch (loadError) {
				if (!cancelled) {
					setError({
						key: 'dialogs.serverConflict.serverError',
						values: {message: errorMessage(loadError)}
					});
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		}

		void load();

		return () => {
			cancelled = true;
		};
	}, [client, storyId]);

	async function resolve(action: (story: Story) => Promise<void>) {
		setBusy(true);

		try {
			await action(localStory);
			props.onClose();
		} catch (resolveError) {
			setError({
				key: 'dialogs.serverConflict.resolveError',
				values: {message: errorMessage(resolveError)}
			});
		} finally {
			setBusy(false);
		}
	}

	return (
		<DialogCard
			{...other}
			className="server-conflict-dialog"
			fixedSize
			headerLabel={t('dialogs.serverConflict.title')}
		>
			<CardContent>
				<p className="server-conflict-explanation">
					{t('dialogs.serverConflict.explanation', {name: localStory.name})}
				</p>
				{error && (
					<p className="server-conflict-error">
						<IconAlertTriangle /> {t(error.key, error.values)}
					</p>
				)}
				<div className="server-conflict-sides">
					<section className="server-conflict-side">
						<h3>
							<IconServer /> {t('dialogs.serverConflict.serverHeading')}
						</h3>
						{loading ? (
							<p>{t('dialogs.serverConflict.loadingServer')}</p>
						) : (
							<ul>
								<li>{serverStory?.name ?? localStory.name}</li>
								{serverStory && (
									<li>
										{t('dialogs.serverConflict.passageCount', {
											count: serverStory.passages?.length ?? 0
										})}
									</li>
								)}
								{serverStory && (
									<li>
										<IconClock />{' '}
										{t('dialogs.serverConflict.savedAt', {
											date: formatDate(serverStory.lastUpdate)
										})}
									</li>
								)}
								{record?.conflictClient && (
									<li>
										{t('dialogs.serverConflict.savedBy', {
											client: record.conflictClient
										})}
									</li>
								)}
								{record?.conflictRev !== undefined && (
									<li>
										{t('dialogs.serverConflict.revision', {
											rev: record.conflictRev
										})}
									</li>
								)}
							</ul>
						)}
					</section>
					<section className="server-conflict-side">
						<h3>
							<IconDeviceDesktop /> {t('dialogs.serverConflict.localHeading')}
						</h3>
						<ul>
							<li>{localStory.name}</li>
							<li>
								{t('dialogs.serverConflict.passageCount', {
									count: localStory.passages.length
								})}
							</li>
							<li>
								<IconClock />{' '}
								{t('dialogs.serverConflict.savedAt', {
									date: formatDate(localStory.lastUpdate)
								})}
							</li>
							{record?.rev !== undefined && (
								<li>
									{t('dialogs.serverConflict.revision', {rev: record.rev})}
								</li>
							)}
						</ul>
					</section>
				</div>
				<div className="server-conflict-choices">
					<ButtonBar>
						<TestId testId="conflict-keep-mine">
							<IconButton
								disabled={busy}
								icon={<IconDeviceDesktop />}
								label={t('dialogs.serverConflict.keepMine')}
								onClick={() => resolve(actions.resolveKeepMine)}
								variant="primary"
							/>
						</TestId>
						<TestId testId="conflict-take-theirs">
							<IconButton
								disabled={busy}
								icon={<IconServer />}
								label={t('dialogs.serverConflict.takeTheirs')}
								onClick={() => resolve(actions.resolveTakeTheirs)}
								variant="danger"
							/>
						</TestId>
						<TestId testId="conflict-later">
							<IconButton
								disabled={busy}
								icon={<IconClock />}
								label={t('dialogs.serverConflict.later')}
								onClick={() => props.onClose()}
							/>
						</TestId>
					</ButtonBar>
					<ul className="server-conflict-outcomes">
						<li>{t('dialogs.serverConflict.keepMineExplanation')}</li>
						<li>{t('dialogs.serverConflict.takeTheirsExplanation')}</li>
						<li>{t('dialogs.serverConflict.laterExplanation')}</li>
					</ul>
				</div>
			</CardContent>
		</DialogCard>
	);
};
