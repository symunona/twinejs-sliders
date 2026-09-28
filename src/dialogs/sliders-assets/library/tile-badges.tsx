import * as React from 'react';
import {useTranslation} from 'react-i18next';
import type {RecordSync} from './library-model';

export interface TileBadgesProps {
	/** Stories using it (`●N`). 0 hides the badge. */
	usage: number;
	onUsages: () => void;
	/** `⑂ forked from tavern-set/night` on a fork in Mine. */
	forkedFrom?: string;
	/** `⑂ shadowed here`: the story's own copy of the same name wins. */
	shadowed?: boolean;
	sync: RecordSync;
	onConflict: () => void;
	/** Shown in All assets: where it lives. */
	collection?: string;
}

/** `●N`, `⑂`, `↑`, `⚠`, download spinner (plan 1 "Tile badges", plan 2 "Tile"). */
export const TileBadges: React.FC<TileBadgesProps> = props => {
	const {collection, forkedFrom, onConflict, onUsages, shadowed, sync, usage} =
		props;
	const {t} = useTranslation();

	return (
		<>
			{collection && (
				<span className="badge variant-neutral library-badge-collection">
					{collection}
				</span>
			)}
			{usage > 0 && (
				<button
					className="library-badge library-badge-usage"
					onClick={onUsages}
					title={t('dialogs.library.badge.usageTitle', {count: usage})}
					type="button"
				>
					●{usage}
				</button>
			)}
			{forkedFrom && (
				<span
					className="library-badge library-badge-fork"
					title={t('dialogs.library.badge.forkedFrom', {from: forkedFrom})}
				>
					⑂
				</span>
			)}
			{shadowed && (
				<span
					className="library-badge library-badge-fork"
					title={t('dialogs.library.badge.shadowed')}
				>
					⑂
				</span>
			)}
			{sync === 'pending' && (
				<span
					className="library-badge library-badge-pending"
					title={t('dialogs.library.badge.pending')}
				>
					↑
				</span>
			)}
			{sync === 'conflict' && (
				<button
					className="library-badge library-badge-conflict"
					onClick={onConflict}
					title={t('dialogs.library.badge.conflict')}
					type="button"
				>
					⚠
				</button>
			)}
			{sync === 'downloading' && (
				<span
					aria-label={t('dialogs.library.badge.downloading')}
					className="library-badge library-spinner"
					role="progressbar"
				/>
			)}
		</>
	);
};
