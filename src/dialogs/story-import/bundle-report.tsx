import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../components/container/button-bar';
import {IconButton} from '../../components/control/icon-button';
import {IconFileImport, IconX} from '@tabler/icons';
import {BundlePlan} from '../../util/sliders-bundle';

export interface BundleReportProps {
	busy?: boolean;
	onCancel: () => void;
	onImport: () => void;
	plan: BundlePlan;
	/** Named so that picking the wrong zip is obvious before the button is pressed. */
	storyName?: string;
	warnings: string[];
}

/**
 * What importing this bundle will do to the asset library, shown before a single byte is
 * written. The clash outcomes are lossy on purpose — scene YAML addresses assets by name,
 * so an incoming asset can never be renamed out of the way — which makes showing them
 * beforehand the whole point of splitting plan from apply.
 */
export const BundleReport: React.FC<BundleReportProps> = props => {
	const {busy, onCancel, onImport, plan, storyName, warnings} = props;
	const {t} = useTranslation();

	const counts = plan.assets.reduce(
		(result, asset) => ({
			...result,
			[asset.outcome]: result[asset.outcome] + 1
		}),
		{'kept-existing': 0, imported: 0, 'new-id': 0, reused: 0}
	);
	const added = counts.imported + counts['new-id'];
	const merged = plan.characters.filter(
		character => character.outcome === 'merged'
	).length;
	const addedCharacters = plan.characters.length - merged;
	const allWarnings = [...warnings, ...plan.warnings];

	return (
		<div className="bundle-report">
			<h2>{t('dialogs.storyImport.bundleTitle')}</h2>
			{storyName && (
				<p>{t('dialogs.storyImport.bundleFrom', {name: storyName})}</p>
			)}
			<ul>
				{added > 0 && (
					<li>{t('dialogs.storyImport.bundleAdding', {count: added})}</li>
				)}
				{counts.reused > 0 && (
					<li>
						{t('dialogs.storyImport.bundleReusing', {count: counts.reused})}
					</li>
				)}
				{counts['kept-existing'] > 0 && (
					<li>
						{t('dialogs.storyImport.bundleKeeping', {
							count: counts['kept-existing']
						})}
					</li>
				)}
				{addedCharacters > 0 && (
					<li>
						{t('dialogs.storyImport.bundleCharactersAdded', {
							count: addedCharacters
						})}
					</li>
				)}
				{merged > 0 && (
					<li>
						{t('dialogs.storyImport.bundleCharactersMerged', {count: merged})}
					</li>
				)}
			</ul>
			{allWarnings.length > 0 && (
				<>
					<p>{t('dialogs.storyImport.bundleWarnings')}</p>
					<ul className="bundle-warnings">
						{allWarnings.map(warning => (
							<li key={warning}>{warning}</li>
						))}
					</ul>
				</>
			)}
			<ButtonBar>
				<IconButton
					disabled={busy}
					icon={<IconFileImport />}
					label={
						busy
							? t('dialogs.storyImport.bundleApplying')
							: t('dialogs.storyImport.bundleApply')
					}
					onClick={onImport}
					variant="primary"
				/>
				<IconButton
					disabled={busy}
					icon={<IconX />}
					label={t('dialogs.storyImport.bundleCancel')}
					onClick={onCancel}
				/>
			</ButtonBar>
		</div>
	);
};
