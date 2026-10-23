/**
 * Pick the particle picture: any still image asset, by NAME (what `sprite:` writes).
 * Shared by the Particles dialog (the emitter's own sprite) and the scene editor's
 * Particles tab (`emit: {sprite: …}`).
 *
 * `base` is what "no choice" means here — the dialog's none (soft dot), the scene's
 * asset sprite. The chosen tile is highlighted; one away from `base` is "overridden".
 */

import type {AssetMeta} from '@sliders/scene-types';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {AssetPreview} from '../sliders-assets/asset-preview';
import {filterSprites, spriteCandidates} from './sprite-candidates';
import './sprite-picker.css';

/** Above this many, a filter box appears. */
const FILTER_FROM = 24;

export interface SpritePickerProps {
	assets: AssetMeta[];
	/** The sprite in force, by name. */
	value?: string;
	/** What clearing goes back to. */
	base?: string;
	onPick: (name: string | undefined) => void;
	disabled?: boolean;
	/** What the first tile (`onPick(undefined)`) means here. Default: the soft dot. */
	noneLabel?: string;
}

export const SpritePicker: React.FC<SpritePickerProps> = props => {
	const {assets, base, disabled, noneLabel, onPick, value} = props;
	const {t} = useTranslation();
	const [query, setQuery] = React.useState('');
	const all = React.useMemo(() => spriteCandidates(assets), [assets]);
	const shown = filterSprites(all, query);
	const overridden = value !== base;
	const none = noneLabel ?? t('dialogs.slidersParticles.spriteNone');

	return (
		<div className={classNames('sprite-picker', {overridden})}>
			<div className="sprite-picker-head">
				<span>
					{t('dialogs.slidersParticles.sprite')}: {value ?? none}
				</span>
				{all.length > FILTER_FROM && (
					<input
						aria-label={t('dialogs.slidersParticles.spriteFilter')}
						onChange={event => setQuery(event.target.value)}
						placeholder={t('dialogs.slidersParticles.spriteFilter')}
						type="search"
						value={query}
					/>
				)}
			</div>
			<div className="sprite-picker-tiles">
				<button
					className={classNames({selected: value === undefined})}
					disabled={disabled}
					onClick={() => onPick(undefined)}
					title={none}
					type="button"
				>
					<span className="sprite-picker-dot" />
				</button>
				{shown.map(asset => (
					<button
						className={classNames({selected: asset.name === value})}
						disabled={disabled}
						key={asset.id}
						onClick={() => onPick(asset.name)}
						title={asset.name}
						type="button"
					>
						<AssetPreview alt={asset.name} assetId={asset.id} />
					</button>
				))}
			</div>
		</div>
	);
};
