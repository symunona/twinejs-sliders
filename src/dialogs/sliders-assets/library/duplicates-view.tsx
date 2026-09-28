import {AssetRecord, LibraryEngine} from '@sliders/asset-library';
import {IconGitMerge, IconX} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../../components/container/button-bar';
import {IconButton} from '../../../components/control/icon-button';
import type {Story} from '../../../store/stories';
import {AssetPreview} from '../asset-preview';
import {DupeGroup, DupeTier} from './library-model';
import {MergePlan, MergeRewrite, mergePlan} from './merge-plan';

export interface DuplicatesViewProps {
	engine: LibraryEngine;
	groups: DupeGroup[];
	stories: readonly Story[];
	collectionName: (id: string) => string;
	storyName: (id: string) => string | undefined;
	/** One undoable passage update per story. */
	applyRewrites: (rewrites: MergeRewrite[]) => void;
}

const TIERS: DupeTier[] = ['exact', 'pixel', 'similar'];

/**
 * Duplicates (plan 1): groups by tier, side by side. Merge picks a survivor, previews
 * the scene rewrites, then rewrites local stories and tombstones the rest.
 */
export const DuplicatesView: React.FC<DuplicatesViewProps> = props => {
	const {applyRewrites, collectionName, engine, groups, stories, storyName} =
		props;
	const {t} = useTranslation();
	const [survivors, setSurvivors] = React.useState<Record<string, string>>({});
	const [plan, setPlan] = React.useState<{key: string; plan: MergePlan}>();
	const [error, setError] = React.useState<string>();

	function survivorOf(group: DupeGroup): AssetRecord {
		return (
			group.assets.find(asset => asset.id === survivors[group.key]) ??
			group.assets[0]
		);
	}

	function preview(group: DupeGroup) {
		const survivor = survivorOf(group);

		setError(undefined);
		setPlan({
			key: group.key,
			plan: mergePlan(
				engine,
				survivor,
				group.assets.filter(asset => asset.id !== survivor.id),
				stories
			)
		});
	}

	function merge(current: MergePlan) {
		try {
			applyRewrites(current.rewrites);

			for (const loser of current.losers) {
				engine.delete(loser.id, 'asset');
			}

			setPlan(undefined);
		} catch (mergeError) {
			console.error('Could not merge duplicates', mergeError);
			setError(t('dialogs.library.dupes.error'));
		}
	}

	if (groups.length === 0) {
		return <p className="sliders-empty">{t('dialogs.library.dupes.none')}</p>;
	}

	return (
		<div className="library-dupes">
			{TIERS.map(tier => {
				const tierGroups = groups.filter(group => group.tier === tier);

				if (tierGroups.length === 0) {
					return null;
				}

				return (
					<section data-tier={tier} key={tier}>
						<h4>{t(`dialogs.library.dupes.tier.${tier}`)}</h4>
						{tierGroups.map(group => (
							<div
								className="library-dupe-group"
								data-group={group.key}
								key={group.key}
							>
								<div className="library-dupe-members">
									{group.assets.map(asset => (
										<label className="library-dupe-member" key={asset.id}>
											<AssetPreview alt={asset.name} assetId={asset.id} />
											<span>
												<input
													checked={survivorOf(group).id === asset.id}
													name={`survivor-${group.key}`}
													onChange={() =>
														setSurvivors({...survivors, [group.key]: asset.id})
													}
													type="radio"
												/>
												{collectionName(asset.collection)} / {asset.name}
											</span>
											<span className="sliders-tile-detail">
												{t('dialogs.library.dupes.uses', {
													count: engine.usage(asset.id).length
												})}
											</span>
										</label>
									))}
								</div>
								<ButtonBar>
									<IconButton
										icon={<IconGitMerge />}
										label={t('dialogs.library.dupes.merge')}
										onClick={() => preview(group)}
									/>
								</ButtonBar>
								{plan?.key === group.key && (
									<div className="library-ask" role="alertdialog">
										<p>
											{t('dialogs.library.dupes.planIntro', {
												count: plan.plan.losers.length,
												survivor: `${collectionName(
													plan.plan.survivor.collection
												)} / ${plan.plan.survivor.name}`
											})}
										</p>
										{plan.plan.rewrites.length > 0 ? (
											<ul>
												{plan.plan.rewrites.map(rewrite => (
													<li key={rewrite.storyId}>
														{t('dialogs.library.dupes.rewrite', {
															count: Object.keys(rewrite.passageUpdates).length,
															renames: rewrite.renames
																.map(({from, to}) => `${from} → ${to}`)
																.join(', '),
															story: rewrite.storyName
														})}
													</li>
												))}
											</ul>
										) : (
											<p>{t('dialogs.library.dupes.noRewrites')}</p>
										)}
										{plan.plan.remote.length > 0 && (
											<>
												<p>{t('dialogs.library.dupes.remoteIntro')}</p>
												<ul>
													{plan.plan.remote.map(use => (
														<li key={`${use.storyId}/${use.loser}`}>
															{t('dialogs.library.dupes.remote', {
																by: use.by ?? '?',
																name: use.loser,
																story:
																	storyName(use.storyId) ?? use.storyId.slice(0, 8)
															})}
														</li>
													))}
												</ul>
											</>
										)}
										<ButtonBar>
											<IconButton
												icon={<IconGitMerge />}
												label={t('dialogs.library.dupes.confirm')}
												onClick={() => merge(plan.plan)}
												variant="danger"
											/>
											<IconButton
												icon={<IconX />}
												label={t('common.cancel')}
												onClick={() => setPlan(undefined)}
											/>
										</ButtonBar>
									</div>
								)}
							</div>
						))}
					</section>
				);
			})}
			{error && (
				<p className="library-error" role="alert">
					{error}
				</p>
			)}
		</div>
	);
};
