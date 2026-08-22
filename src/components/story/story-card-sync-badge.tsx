import {
	IconCheck,
	IconCloud,
	IconCloudDownload,
	IconCloudOff,
	IconCloudUpload
} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import type {
	SyncRecord,
	SyncState
} from '../../store/persistence/server/server.types';
import './story-card-sync-badge.css';

const timeFormatter = new Intl.DateTimeFormat([], {
	hour: '2-digit',
	minute: '2-digit'
});

export interface StoryCardPresence {
	id: string;
	name: string;
}

export interface StoryCardSyncBadgeProps {
	/**
	 * Other people currently in this story. Presence is filled in by the websocket
	 * layer--the badge only reserves the space and draws initials.
	 */
	presence?: StoryCardPresence[];
	record?: SyncRecord;
	/** The story's local-only `sync` flag. */
	sync?: boolean;
}

function initial(name: string) {
	return (name.trim()[0] ?? '?').toUpperCase();
}

export const StoryCardSyncBadge: React.FC<StoryCardSyncBadgeProps> = props => {
	const {presence, record, sync} = props;
	const {t} = useTranslation();

	// A story nobody has ever published and that isn't marked for sync gets no badge at
	// all--most of the library looks like this.

	if (!record && !sync) {
		return null;
	}

	const state: SyncState = record?.state ?? 'idle';
	const syncedAt = record?.lastPulledAt ?? record?.lastPushedAt;
	let icon: React.ReactNode;
	let label: string;

	switch (state) {
		case 'pushing':
			icon = <IconCloudUpload />;
			label = t('components.storyCard.sync.pushing');
			break;
		case 'pulling':
			icon = <IconCloudDownload />;
			label = t('components.storyCard.sync.pulling');
			break;
		case 'conflict':
			icon = <IconCloud />;
			label = t('components.storyCard.sync.conflict');
			break;
		case 'gone':
			icon = <IconCloudOff />;
			label = t('components.storyCard.sync.gone');
			break;
		case 'error':
			icon = <IconCloudOff />;
			label = t('components.storyCard.sync.error');
			break;
		case 'dirty':
			icon = <IconCloud />;
			label = t('components.storyCard.sync.dirty');
			break;
		default:
			icon = (
				<>
					<IconCloud />
					<IconCheck className="story-card-sync-badge-tick" />
				</>
			);
			label = syncedAt
				? t('components.storyCard.sync.synced', {
						time: timeFormatter.format(syncedAt)
					})
				: t('components.storyCard.sync.pending');
			break;
	}

	return (
		<div
			className={classNames('story-card-sync-badge', `sync-state-${state}`)}
			data-sync-state={state}
			data-testid="story-card-sync-badge"
			title={state === 'error' ? (record?.lastError ?? label) : label}
		>
			<span className="story-card-sync-badge-icon">{icon}</span>
			<span className="story-card-sync-badge-label">{label}</span>
			<span
				className="story-card-sync-badge-presence"
				data-testid="story-card-sync-presence"
			>
				{presence?.map(person => (
					<span
						className="story-card-sync-badge-initial"
						key={person.id}
						title={person.name}
					>
						{initial(person.name)}
					</span>
				))}
			</span>
		</div>
	);
};
