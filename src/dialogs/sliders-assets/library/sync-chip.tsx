import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import type {CollectionSync} from './library-model';
import './library.css';

export type SyncChipState =
	| 'offline'
	| 'conflicts'
	| 'pending'
	| 'downloading'
	| 'synced';

/** Worst first: an offline library with conflicts says offline — nothing moves until it's back. */
export function chipState(sync: CollectionSync): SyncChipState {
	if (sync.offline) {
		return 'offline';
	}

	if (sync.conflicts > 0) {
		return 'conflicts';
	}

	if (sync.pending > 0) {
		return 'pending';
	}

	if (sync.downloading > 0) {
		return 'downloading';
	}

	return 'synced';
}

export interface SyncChipProps {
	sync: CollectionSync;
	/** Conflicts → opens the conflict panel. Only a chip with conflicts is a button. */
	onOpenConflicts?: () => void;
	className?: string;
}

/**
 * `☁ synced` / `↑3` / `↓` / `⚠ 1 conflict` / `⦸ offline` (plan 2, "Sync UI"). Pending
 * shows offline too: edits queue locally, the count says how many.
 */
export const SyncChip: React.FC<SyncChipProps> = props => {
	const {className, onOpenConflicts, sync} = props;
	const {t} = useTranslation();
	const state = chipState(sync);
	const label =
		state === 'offline'
			? sync.pending > 0
				? t('dialogs.library.chip.offlinePending', {count: sync.pending})
				: t('dialogs.library.chip.offline')
			: state === 'conflicts'
			? t('dialogs.library.chip.conflicts', {count: sync.conflicts})
			: state === 'pending'
			? t('dialogs.library.chip.pending', {count: sync.pending})
			: state === 'downloading'
			? t('dialogs.library.chip.downloading', {count: sync.downloading})
			: t('dialogs.library.chip.synced');
	const classes = classNames('library-sync-chip', `state-${state}`, className);

	if (sync.conflicts > 0 && onOpenConflicts) {
		return (
			<button
				className={classes}
				data-state={state}
				onClick={onOpenConflicts}
				title={t('dialogs.library.chip.openConflicts')}
				type="button"
			>
				{label}
			</button>
		);
	}

	return (
		<span className={classes} data-state={state} role="status">
			{label}
		</span>
	);
};
