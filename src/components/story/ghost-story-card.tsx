import {IconCloudDownload, IconTrash} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import type {StoryIndexEntry} from '../../store/persistence/server/server.types';
import type {StoryCreated} from '../../store/persistence/server/story-created';
import {ButtonBar} from '../container/button-bar';
import {Card, CardContent} from '../container/card';
import {ConfirmButton} from '../control/confirm-button';
import {IconButton} from '../control/icon-button';
import './ghost-story-card.css';
import {StoryCardAuthors} from './story-card-authors';
import {StoryCardTitle} from './story-card-title';

export interface GhostStoryCardProps {
	/** For the title's tooltip. See `StoryCardTitle`. */
	created?: StoryCreated;
	entry: StoryIndexEntry;
	/** Pulls the story and every asset it needs. */
	onCheckOut: () => Promise<unknown> | unknown;
	/**
	 * Deletes the story from the server, after a confirmation naming it. Only ghosts get
	 * this: nothing local is left behind to republish from. Omitted, no button.
	 */
	onDelete?: () => Promise<unknown> | unknown;
	/** Asks for `created`. */
	onPeekCreated?: () => void;
	/**
	 * How far the checkout has got, 0 to 1. Undefined draws an indeterminate bar--a
	 * checkout downloads assets eagerly and can take a while with nothing to report yet.
	 */
	progress?: number;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}

	if (bytes < 1024 * 1024) {
		return `${Math.round(bytes / 1024)} KB`;
	}

	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const relativeFormatter = new Intl.RelativeTimeFormat([], {numeric: 'auto'});

const relativeUnits: [Intl.RelativeTimeFormatUnit, number][] = [
	['year', 365 * 24 * 60 * 60 * 1000],
	['month', 30 * 24 * 60 * 60 * 1000],
	['day', 24 * 60 * 60 * 1000],
	['hour', 60 * 60 * 1000],
	['minute', 60 * 1000]
];

export function formatRelativeTime(iso: string, now = Date.now()): string {
	const at = Date.parse(iso);

	if (Number.isNaN(at)) {
		return iso;
	}

	const delta = at - now;

	for (const [unit, size] of relativeUnits) {
		if (Math.abs(delta) >= size) {
			return relativeFormatter.format(Math.round(delta / size), unit);
		}
	}

	return relativeFormatter.format(0, 'minute');
}

export const GhostStoryCard: React.FC<GhostStoryCardProps> = props => {
	const {created, entry, onCheckOut, onDelete, onPeekCreated, progress} = props;
	const buttonRef = React.useRef<HTMLSpanElement>(null);
	const deleteRef = React.useRef<HTMLSpanElement>(null);
	const [busy, setBusy] = React.useState(false);
	const [deleting, setDeleting] = React.useState(false);
	const [deleteError, setDeleteError] = React.useState<string>();
	const {t} = useTranslation();

	// `IconButton` doesn't take arbitrary DOM props, and widening it for one card isn't
	// worth it. Same trick as the backend prefs section.

	React.useEffect(() => {
		buttonRef.current
			?.querySelector('button')
			?.setAttribute('data-testid', 'ghost-checkout');
		deleteRef.current
			?.querySelector('button')
			?.setAttribute('data-testid', 'ghost-delete');
	});

	async function handleDelete() {
		if (!onDelete) {
			return;
		}

		setDeleting(true);
		setDeleteError(undefined);

		try {
			await onDelete();
		} catch (error) {
			setDeleteError(error instanceof Error ? error.message : String(error));
		} finally {
			setDeleting(false);
		}
	}

	async function handleCheckOut() {
		setBusy(true);

		try {
			await onCheckOut();
		} finally {
			setBusy(false);
		}
	}

	return (
		<div
			className="ghost-story-card"
			data-story-name={entry.name}
			data-testid="ghost-story-card"
		>
			<Card>
				<CardContent>
					<div className="ghost-story-card-summary">
						<StoryCardTitle
							created={created}
							name={entry.name}
							onPeek={onPeekCreated}
						/>
						<p>
							{t('routes.storyList.server.onServer')}
							<br />
							{t('components.storyCard.passageCount', {
								count: entry.passageCount
							})}
							<br />
							{t('routes.storyList.server.ghostSize', {
								size: formatBytes(entry.bytes + entry.assetBytes)
							})}
							<br />
							{t('routes.storyList.server.ghostUpdated', {
								time: formatRelativeTime(entry.updatedAt)
							})}
							<StoryCardAuthors
								createdBy={entry.createdBy}
								lastEditedBy={entry.lastClient}
							/>
						</p>
					</div>
					<ButtonBar>
						<span ref={buttonRef}>
							<IconButton
								disabled={busy}
								icon={<IconCloudDownload />}
								label={t(
									busy
										? 'routes.storyList.server.checkingOut'
										: 'routes.storyList.server.checkOut'
								)}
								onClick={handleCheckOut}
								variant="primary"
							/>
						</span>
						{onDelete && (
							<span ref={deleteRef}>
								<ConfirmButton
									confirmIcon={<IconTrash />}
									confirmLabel={t('routes.storyList.server.deleteFromServer')}
									confirmVariant="danger"
									disabled={busy || deleting}
									icon={<IconTrash />}
									label={t(
										deleting
											? 'routes.storyList.server.deletingFromServer'
											: 'routes.storyList.server.deleteFromServer'
									)}
									onConfirm={() => void handleDelete()}
									prompt={t('routes.storyList.server.deleteFromServerWarning', {
										storyName: entry.name
									})}
									variant="danger"
								/>
							</span>
						)}
					</ButtonBar>
					{deleteError && (
						<p className="ghost-story-card-error" role="alert">
							{t('routes.storyList.server.deleteFromServerFailed', {
								message: deleteError
							})}
						</p>
					)}
					{busy && (
						<progress
							className="ghost-story-card-progress"
							data-testid="ghost-checkout-progress"
							max={1}
							value={progress}
						/>
					)}
				</CardContent>
			</Card>
		</div>
	);
};
