import {AssetRecord, DuplicateReport} from '@sliders/asset-library';
import {IconCheck, IconX} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../../components/container/button-bar';
import {IconButton} from '../../../components/control/icon-button';
import {AssetPreview} from '../asset-preview';

export type DupeChoice =
	| {kind: 'use'; asset: AssetRecord}
	| {kind: 'alias'; name: string}
	| {kind: 'separate'};

export interface DupeDialogProps {
	fileName: string;
	report: DuplicateReport;
	/** Name the upload would get, already free in the target collection. */
	suggestedName: string;
	collectionName: (id: string) => string;
	/** The match's collection is already in the story's view: no attach needed. */
	inView: (collection: string) => boolean;
	onAnswer: (choice: DupeChoice | undefined) => void;
}

/** The asset an upload collided with, and how sure we are. */
export function dupeMatch(
	report: DuplicateReport
): {asset: AssetRecord; tier: 'exact' | 'pixel' | 'similar'} | undefined {
	if (report.exact.length) {
		return {asset: report.exact[0], tier: 'exact'};
	}

	if (report.pixel.length) {
		return {asset: report.pixel[0], tier: 'pixel'};
	}

	if (report.similar.length) {
		return {asset: report.similar[0].asset, tier: 'similar'};
	}

	return undefined;
}

/**
 * "Already in the library" (plan 1). Exact bytes: default = a new name on the same
 * blob (zero bytes stored). Pixel / perceptual: "Looks like…", default = a separate
 * asset — a guess never merges anything by itself.
 */
export const DupeDialog: React.FC<DupeDialogProps> = props => {
	const {collectionName, fileName, inView, onAnswer, report, suggestedName} =
		props;
	const {t} = useTranslation();
	const match = dupeMatch(report)!;
	const exact = match.tier === 'exact';
	const [choice, setChoice] = React.useState<DupeChoice['kind']>(
		exact ? 'alias' : 'separate'
	);
	const [name, setName] = React.useState(suggestedName);
	const where = `${collectionName(match.asset.collection)} / ${match.asset.name}`;

	function submit() {
		if (choice === 'use') {
			onAnswer({asset: match.asset, kind: 'use'});
		} else if (choice === 'alias') {
			onAnswer({kind: 'alias', name: name.trim() || suggestedName});
		} else {
			onAnswer({kind: 'separate'});
		}
	}

	return (
		<div
			aria-label={t('dialogs.library.dupe.title')}
			className="library-ask library-dupe"
			role="alertdialog"
		>
			<h4>{t('dialogs.library.dupe.title')}</h4>
			<div className="library-dupe-body">
				<AssetPreview alt={match.asset.name} assetId={match.asset.id} />
				<p>
					{t(
						exact
							? 'dialogs.library.dupe.sameFile'
							: 'dialogs.library.dupe.looksLike',
						{file: fileName, where}
					)}
				</p>
			</div>
			<fieldset className="library-dupe-options">
				<label>
					<input
						checked={choice === 'use'}
						name="library-dupe"
						onChange={() => setChoice('use')}
						type="radio"
						value="use"
					/>
					{inView(match.asset.collection)
						? t('dialogs.library.dupe.use', {name: match.asset.name})
						: t('dialogs.library.dupe.useAttach', {
								collection: collectionName(match.asset.collection),
								name: match.asset.name
						  })}
				</label>
				{exact && (
					<label>
						<input
							checked={choice === 'alias'}
							name="library-dupe"
							onChange={() => setChoice('alias')}
							type="radio"
							value="alias"
						/>
						{t('dialogs.library.dupe.alias')}{' '}
						<input
							aria-label={t('dialogs.library.dupe.aliasName')}
							onChange={event => {
								setName(event.target.value);
								setChoice('alias');
							}}
							type="text"
							value={name}
						/>
					</label>
				)}
				<label>
					<input
						checked={choice === 'separate'}
						name="library-dupe"
						onChange={() => setChoice('separate')}
						type="radio"
						value="separate"
					/>
					{t('dialogs.library.dupe.separate')}
				</label>
			</fieldset>
			<ButtonBar>
				<IconButton
					icon={<IconX />}
					label={t('common.cancel')}
					onClick={() => onAnswer(undefined)}
				/>
				<IconButton
					icon={<IconCheck />}
					label={t('common.ok')}
					onClick={submit}
					variant="primary"
				/>
			</ButtonBar>
		</div>
	);
};
