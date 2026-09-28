import {
	ActivityEntry,
	AssetRecord,
	CollectionRecord,
	LibraryEngine,
	LibRecord,
	RevEntry
} from '@sliders/asset-library';
import {IconArrowBack, IconEye} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../../components/container/button-bar';
import {IconButton} from '../../../components/control/icon-button';
import {BlobPreview} from './blob-preview';

const timeFormat =
	typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl
		? new Intl.RelativeTimeFormat([], {numeric: 'auto'})
		: undefined;

/** "2 min ago". Falls back to the timestamp. */
export function ago(at: string, now = Date.now()): string {
	const then = Date.parse(at);

	if (!timeFormat || Number.isNaN(then)) {
		return at;
	}

	const seconds = Math.round((then - now) / 1000);
	const steps: [number, Intl.RelativeTimeFormatUnit][] = [
		[60, 'second'],
		[60, 'minute'],
		[24, 'hour'],
		[30, 'day'],
		[12, 'month']
	];
	let value = seconds;

	for (const [size, unit] of steps) {
		if (Math.abs(value) < size) {
			return timeFormat.format(value, unit);
		}

		value = Math.round(value / size);
	}

	return timeFormat.format(value, 'year');
}

function nameOf(record: LibRecord | undefined): string {
	return String(record?.name ?? record?.charId ?? record?.id ?? '');
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export interface ActivityPanelProps {
	engine: LibraryEngine;
	collection: string;
	version: number;
	/** Revert = a new rev copying the one before this change. */
	onRevert: (entry: ActivityEntry) => void;
}

/** Last 50 changes to a collection: who, what, when, view, revert (plan 2). */
export const ActivityPanel: React.FC<ActivityPanelProps> = props => {
	const {collection, engine, onRevert, version} = props;
	const {t} = useTranslation();
	const [entries, setEntries] = React.useState<ActivityEntry[]>();
	const [viewing, setViewing] = React.useState<string>();
	const [failed, setFailed] = React.useState(false);

	React.useEffect(() => {
		let live = true;

		engine.activity(collection).then(
			result => live && setEntries(result),
			error => {
				console.error('Could not read the activity feed', error);

				if (live) {
					setFailed(true);
				}
			}
		);

		return () => {
			live = false;
		};
	}, [collection, engine, version]);

	if (failed) {
		return <p className="library-error">{t('dialogs.library.activity.error')}</p>;
	}

	if (!entries) {
		return <p className="sliders-empty">{t('dialogs.library.loading')}</p>;
	}

	if (entries.length === 0) {
		return <p className="sliders-empty">{t('dialogs.library.activity.empty')}</p>;
	}

	return (
		<ol className="library-activity">
			{entries.map(entry => {
				const key = `${entry.type}/${entry.id}/${entry.rev}`;

				return (
					<li data-action={entry.action} key={key}>
						<span className="library-activity-text">
							{t(`dialogs.library.activity.${entry.action}`, {
								by: entry.by || '?',
								detail: entry.detail ?? '',
								name: nameOf(entry.record)
							})}
						</span>
						<span className="library-activity-when" title={entry.at}>
							{ago(entry.at)}
						</span>
						<ButtonBar>
							{entry.type === 'asset' && (
								<IconButton
									icon={<IconEye />}
									iconOnly
									label={t('dialogs.library.activity.view')}
									onClick={() => setViewing(viewing === key ? undefined : key)}
									selectable
									selected={viewing === key}
								/>
							)}
							<IconButton
								icon={<IconArrowBack />}
								iconOnly
								label={t('dialogs.library.activity.revert')}
								onClick={() => onRevert(entry)}
							/>
						</ButtonBar>
						{viewing === key && (
							<BlobPreview
								alt={nameOf(entry.record)}
								engine={engine}
								sha={(entry.record as AssetRecord).blob}
							/>
						)}
					</li>
				);
			})}
		</ol>
	);
};

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export interface VersionsPanelProps {
	engine: LibraryEngine;
	asset: AssetRecord;
	version: number;
	onRestore: (rev: RevEntry) => void;
}

/** Rev list with thumbnails. Restore = a new rev pointing at the old blob. */
export const VersionsPanel: React.FC<VersionsPanelProps> = props => {
	const {asset, engine, onRestore, version} = props;
	const {t} = useTranslation();
	const [revs, setRevs] = React.useState<RevEntry[]>();

	React.useEffect(() => {
		let live = true;

		engine.revs(asset.id, 'asset').then(
			result => live && setRevs(result),
			error => {
				console.error('Could not read versions', error);

				if (live) {
					setRevs([]);
				}
			}
		);

		return () => {
			live = false;
		};
	}, [asset.id, engine, version]);

	if (!revs) {
		return <p className="sliders-empty">{t('dialogs.library.loading')}</p>;
	}

	if (revs.length === 0) {
		return <p className="sliders-empty">{t('dialogs.library.versions.empty')}</p>;
	}

	return (
		<ol className="library-versions">
			{revs.map(entry => {
				const record = entry.record as AssetRecord;
				const current = record.blob === asset.blob;

				return (
					<li data-rev={entry.rev} key={entry.rev}>
						<BlobPreview alt={record.name} engine={engine} sha={record.blob} />
						<span>
							{t('dialogs.library.versions.row', {
								by: entry.by || '?',
								name: record.name,
								rev: entry.rev
							})}
						</span>
						<span className="library-activity-when" title={entry.at}>
							{ago(entry.at)}
						</span>
						{current ? (
							<span className="library-versions-current">
								{t('dialogs.library.versions.current')}
							</span>
						) : (
							<IconButton
								icon={<IconArrowBack />}
								label={t('dialogs.library.versions.restore')}
								onClick={() => onRestore(entry)}
							/>
						)}
					</li>
				);
			})}
		</ol>
	);
};

// ---------------------------------------------------------------------------
// Usages
// ---------------------------------------------------------------------------

export interface UsagesPanelProps {
	engine: LibraryEngine;
	assetId: string;
	storyId: string;
	storyName: (id: string) => string | undefined;
}

/** Stories whose scenes use this asset, with who last wrote each one's binding. */
export const UsagesPanel: React.FC<UsagesPanelProps> = props => {
	const {assetId, engine, storyId, storyName} = props;
	const {t} = useTranslation();
	const stories = engine.usage(assetId);

	if (stories.length === 0) {
		return <p className="sliders-empty">{t('dialogs.library.usages.none')}</p>;
	}

	return (
		<ul className="library-usages">
			{stories.map(id => (
				<li key={id}>
					{storyName(id) ??
						t('dialogs.library.usages.remote', {
							id:
								engine.get(engine.binding(id)?.own ?? '', 'collection')?.name ??
								id.slice(0, 8)
						})}
					{id === storyId && ` ${t('dialogs.library.usages.thisStory')}`}
					{engine.binding(id)?.by && (
						<span className="library-usages-by">
							{t('dialogs.library.usages.by', {by: engine.binding(id)!.by})}
						</span>
					)}
				</li>
			))}
		</ul>
	);
};

// ---------------------------------------------------------------------------
// Move to collection…
// ---------------------------------------------------------------------------

export interface MovePanelProps {
	asset: AssetRecord;
	collections: CollectionRecord[];
	label: (collection: CollectionRecord) => string;
	onPick: (collection: string, copy: boolean) => void;
}

export const MovePanel: React.FC<MovePanelProps> = props => {
	const {asset, collections, label, onPick} = props;
	const {t} = useTranslation();
	const [copy, setCopy] = React.useState(false);

	return (
		<div className="library-move">
			<p>{t('dialogs.library.move.prompt', {name: asset.name})}</p>
			<label>
				<input
					checked={copy}
					onChange={event => setCopy(event.target.checked)}
					type="checkbox"
				/>
				{t('dialogs.library.move.copy')}
			</label>
			<ul>
				{collections
					.filter(collection => collection.id !== asset.collection)
					.map(collection => (
						<li key={collection.id}>
							<button
								onClick={() => onPick(collection.id, copy)}
								type="button"
							>
								{label(collection)}
							</button>
						</li>
					))}
			</ul>
		</div>
	);
};
