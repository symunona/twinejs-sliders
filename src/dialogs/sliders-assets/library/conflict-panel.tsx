import {
	AssetRecord,
	ConflictChoice,
	ConflictInfo,
	ENVELOPE_FIELDS,
	FieldPick,
	LibraryEngine,
	LibRecord,
	deepEqual
} from '@sliders/asset-library';
import {IconCheck} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../../components/container/button-bar';
import {IconButton} from '../../../components/control/icon-button';
import {BlobPreview} from './blob-preview';

/** Fields a person recognises; the rest (`bytes`, `phash`) ride along with `blob`. */
const HIDDEN_FIELDS = new Set([
	...ENVELOPE_FIELDS,
	'bytes',
	'mime',
	'w',
	'h',
	'pixelHash',
	'phash'
]);

function recordName(record: LibRecord | null | undefined): string {
	if (!record) {
		return '';
	}

	return String(record.name ?? record.charId ?? record.id);
}

function show(value: unknown): string {
	if (value === undefined || value === null) {
		return '—';
	}

	if (Array.isArray(value)) {
		return value.join(', ') || '—';
	}

	if (typeof value === 'object') {
		return JSON.stringify(value);
	}

	return String(value);
}

/** Top-level fields that differ anywhere between base, mine and theirs. */
function changedFields(conflict: ConflictInfo): string[] {
	const records = [conflict.base, conflict.local, conflict.current].filter(
		Boolean
	) as LibRecord[];
	const keys = new Set(records.flatMap(record => Object.keys(record)));

	return [...keys]
		.filter(key => !HIDDEN_FIELDS.has(key))
		.filter(key => {
			const values = records.map(record => record[key]);

			return values.some(value => !deepEqual(value, values[0]));
		})
		.sort();
}

export interface ConflictCardProps {
	conflict: ConflictInfo;
	engine: LibraryEngine;
	collectionName: (id: string) => string;
	onResolved?: () => void;
}

/**
 * One record's conflict (plan 2, "Conflict panel"): base / mine / theirs side by side,
 * a pick per conflicting field, auto-merged fields shown, Keep both for a repaint.
 */
export const ConflictCard: React.FC<ConflictCardProps> = props => {
	const {collectionName, conflict, engine, onResolved} = props;
	const {t} = useTranslation();
	const isAsset = conflict.type === 'asset';
	const picturesDiffer =
		isAsset && conflict.fields.includes('blob');
	const [picks, setPicks] = React.useState<Record<string, FieldPick>>(() =>
		Object.fromEntries(conflict.fields.map(field => [field, 'mine']))
	);
	const [keepBoth, setKeepBoth] = React.useState(false);
	const [error, setError] = React.useState<string>();
	const theirs = conflict.current;
	const who = theirs?.by || t('dialogs.library.conflict.theirs');
	const collection = String(
		(conflict.local as AssetRecord).collection ?? conflict.id
	);
	const fieldsKind = conflict.kind === 'fields' && !!theirs;
	const shown = fieldsKind ? changedFields(conflict) : [];
	const conflictTop = new Set(conflict.fields.map(field => field.split('.')[0]));

	function resolve(choice: ConflictChoice) {
		setError(undefined);

		try {
			engine.resolve(conflict.id, choice, conflict.type);
			onResolved?.();
		} catch (resolveError) {
			console.error('Could not resolve the conflict', resolveError);
			setError(t('dialogs.library.conflict.error'));
		}
	}

	function submit() {
		if (keepBoth) {
			resolve('keep-both');
			return;
		}

		// Hidden picture fields (pixelHash, w, h …) follow the pixels' pick.
		const all: Record<string, FieldPick> = {...picks};

		for (const field of conflict.fields) {
			if (HIDDEN_FIELDS.has(field.split('.')[0]) && picks.blob) {
				all[field] = picks.blob;
			}
		}

		const values = Object.values(all);

		if (values.every(pick => pick === 'mine')) {
			resolve('mine');
		} else if (values.every(pick => pick === 'theirs')) {
			resolve('theirs');
		} else {
			resolve({picks: all});
		}
	}

	return (
		<section
			aria-label={t('dialogs.library.conflict.title', {
				collection: collectionName(collection),
				name: recordName(conflict.local)
			})}
			className="library-conflict"
			data-record-id={conflict.id}
		>
			<h4>
				{t('dialogs.library.conflict.title', {
					collection: collectionName(collection),
					name: recordName(conflict.local)
				})}
			</h4>
			{!fieldsKind ? (
				<>
					<p>
						{t(`dialogs.library.conflict.kind.${conflict.kind}`, {
							name: recordName(conflict.local)
						})}
					</p>
					<ButtonBar>
						<IconButton
							icon={<IconCheck />}
							label={t('dialogs.library.conflict.retryMine')}
							onClick={() => resolve('mine')}
						/>
						<IconButton
							icon={<IconCheck />}
							label={t('dialogs.library.conflict.dropMine')}
							onClick={() => resolve('theirs')}
							variant="danger"
						/>
					</ButtonBar>
				</>
			) : (
				<>
					<table className="library-conflict-table">
						<thead>
							<tr>
								<th />
								<th>
									{t('dialogs.library.conflict.base', {
										rev: conflict.base?.rev ?? 0
									})}
								</th>
								<th>{t('dialogs.library.conflict.mine')}</th>
								<th>
									{t('dialogs.library.conflict.theirsRev', {
										rev: theirs!.rev,
										who
									})}
								</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{isAsset && (
								<tr className="library-conflict-pictures">
									<th>{t('dialogs.library.conflict.pixels')}</th>
									{[conflict.base, conflict.local, theirs].map(
										(record, index) => (
											<td key={index}>
												<BlobPreview
													alt={recordName(record)}
													engine={engine}
													sha={(record as AssetRecord | undefined)?.blob}
												/>
											</td>
										)
									)}
									<td />
								</tr>
							)}
							{shown.map(field => {
								const conflicting = conflict.fields.filter(
									path => path === field || path.startsWith(`${field}.`)
								);

								return (
									<tr
										className={
											conflictTop.has(field) ? 'conflicting' : 'auto-merged'
										}
										data-field={field}
										key={field}
									>
										<th>{field}</th>
										<td>{show(conflict.base?.[field])}</td>
										<td>{show(conflict.local[field])}</td>
										<td>{show(theirs![field])}</td>
										<td>
											{conflicting.length === 0 ? (
												<span className="library-conflict-auto">
													{t('dialogs.library.conflict.autoMerged')}
												</span>
											) : (
												conflicting.map(path => (
													<span className="library-conflict-pick" key={path}>
														{path !== field && <em>{path}</em>}
														{(['mine', 'theirs'] as FieldPick[]).map(pick => (
															<label key={pick}>
																<input
																	checked={!keepBoth && picks[path] === pick}
																	disabled={keepBoth && path === 'blob'}
																	name={`${conflict.id}-${path}`}
																	onChange={() => {
																		if (path === 'blob') {
																			setKeepBoth(false);
																		}

																		setPicks({...picks, [path]: pick});
																	}}
																	type="radio"
																/>
																{pick === 'mine'
																	? t('dialogs.library.conflict.mine')
																	: who}
															</label>
														))}
														{path === 'blob' && picturesDiffer && (
															<label>
																<input
																	checked={keepBoth}
																	name={`${conflict.id}-${path}`}
																	onChange={() => setKeepBoth(true)}
																	type="radio"
																/>
																{t('dialogs.library.conflict.keepBoth', {
																	name: `${recordName(conflict.local)}-2`
																})}
															</label>
														)}
													</span>
												))
											)}
										</td>
									</tr>
								);
							})}
							{conflict.fields.includes('deleted') && (
								<tr className="conflicting" data-field="deleted">
									<th>{t('dialogs.library.conflict.deleted')}</th>
									<td>{show(conflict.base?.deleted)}</td>
									<td>{show(conflict.local.deleted)}</td>
									<td>{show(theirs!.deleted)}</td>
									<td>
										{(['mine', 'theirs'] as FieldPick[]).map(pick => (
											<label key={pick}>
												<input
													checked={picks.deleted === pick}
													name={`${conflict.id}-deleted`}
													onChange={() => setPicks({...picks, deleted: pick})}
													type="radio"
												/>
												{pick === 'mine'
													? t('dialogs.library.conflict.restoreMine')
													: t('dialogs.library.conflict.acceptDelete')}
											</label>
										))}
									</td>
								</tr>
							)}
						</tbody>
					</table>
					<ButtonBar>
						<IconButton
							icon={<IconCheck />}
							label={t('dialogs.library.conflict.resolve')}
							onClick={submit}
							variant="primary"
						/>
					</ButtonBar>
				</>
			)}
			{error && (
				<p className="library-error" role="alert">
					{error}
				</p>
			)}
		</section>
	);
};

export interface ConflictPanelProps {
	engine: LibraryEngine;
	/** Only this collection's conflicts. Undefined = all. */
	collection?: string;
	/** Only this record. */
	recordId?: string;
	collectionName: (id: string) => string;
	/** Bumps when the library changes, so resolved conflicts drop out. */
	version: number;
}

export function conflictsFor(
	engine: LibraryEngine,
	collection?: string,
	recordId?: string
): ConflictInfo[] {
	return engine.conflicts().filter(conflict => {
		if (recordId) {
			return conflict.id === recordId;
		}

		if (!collection) {
			return true;
		}

		const home = [conflict.local, conflict.current].map(record =>
			record && (record.type === 'asset' || record.type === 'character')
				? record.collection
				: record?.type === 'collection'
				? record.id
				: undefined
		);

		return home.includes(collection);
	});
}

export const ConflictPanel: React.FC<ConflictPanelProps> = props => {
	const {collection, collectionName, engine, recordId, version} = props;
	const {t} = useTranslation();
	const conflicts = React.useMemo(
		() => conflictsFor(engine, collection, recordId),
		// `version` is the change signal.
		[engine, collection, recordId, version]
	);

	if (conflicts.length === 0) {
		return <p className="sliders-empty">{t('dialogs.library.conflict.none')}</p>;
	}

	return (
		<div className="library-conflicts">
			{conflicts.map(conflict => (
				<ConflictCard
					collectionName={collectionName}
					conflict={conflict}
					engine={engine}
					key={`${conflict.type}/${conflict.id}/${conflict.current?.rev ?? 0}`}
				/>
			))}
		</div>
	);
};
