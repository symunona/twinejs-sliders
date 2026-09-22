import type {AssetEffect, GlitchEffect} from '@sliders/scene-types';
import {GLITCH_DEFAULTS, GLITCH_RANGES, effectIsIdle} from '@sliders/render-dom';
import {
	IconAntenna,
	IconBolt,
	IconBoltOff,
	IconDeviceTvOld,
	IconFlare,
	IconWaveSawTool
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../components/container/button-bar';
import {IconButton} from '../../components/control/icon-button';
import {AdjustSlider} from './adjust-slider';
import {NoteBody, useNote} from './editor-note';
import {EditorSection} from './editor-section';

export interface EffectToolProps {
	disabled?: boolean;
	effect?: AssetEffect;
	/** Absent means no effect at all, which is what the vast majority of assets want. */
	onChange: (effect: AssetEffect | undefined) => void;
}

/** Which selector button an effect answers to. `none` is the absence of one. */
type EffectChoice = 'none' | 'glitch';

const CHOICES: EffectChoice[] = ['none', 'glitch'];

const CHOICE_ICONS: Record<EffectChoice, React.ReactNode> = {
	glitch: <IconBolt />,
	none: <IconBoltOff />
};

/** One per preset, so the row is scannable without reading four labels. */
const PRESET_ICONS: Record<string, React.ReactNode> = {
	broken: <IconWaveSawTool />,
	corrupt: <IconFlare />,
	signal: <IconAntenna />,
	vhs: <IconDeviceTvOld />
};

/**
 * The knobs, in the order they are worth reaching for.
 *
 * `amount` first because it is the one slider that has to move before anything is visible,
 * and the two overlays last because they are garnish on a look that already works.
 */
const GLITCH_KEYS: (keyof Omit<GlitchEffect, 'kind'>)[] = [
	'amount',
	'bands',
	'speed',
	'split',
	'period',
	'burst',
	'scanlines',
	'noise'
];

/**
 * Starting points, not styles.
 *
 * Eight sliders from a standing start is a long way from a look, and the two numbers that
 * decide whether a glitch reads at all — `amount` and `burst` — are the two whose useful band
 * is narrowest. A preset lands inside it; the sliders are then for taste.
 */
export const GLITCH_PRESETS: {effect: GlitchEffect; id: string}[] = [
	{
		id: 'signal',
		effect: {...GLITCH_DEFAULTS, amount: 18, bands: 4, burst: 25, split: 22}
	},
	{
		id: 'broken',
		effect: {
			...GLITCH_DEFAULTS,
			amount: 60,
			bands: 7,
			burst: 55,
			period: 1.6,
			speed: 30,
			split: 45
		}
	},
	{
		id: 'vhs',
		effect: {
			...GLITCH_DEFAULTS,
			amount: 12,
			bands: 3,
			burst: 30,
			noise: 22,
			period: 3.2,
			scanlines: 55,
			speed: 14,
			split: 35
		}
	},
	{
		id: 'corrupt',
		effect: {
			...GLITCH_DEFAULTS,
			amount: 90,
			bands: 11,
			burst: 80,
			noise: 40,
			period: 1,
			speed: 40,
			split: 70
		}
	}
];

/**
 * The right pane for asset effects: which effect, and what it is set to.
 *
 * An effect is the only thing this editor writes that does not touch the pixels. Every other
 * tool bakes: a crop resizes the bytes, a cutout rewrites their alpha. There is no still frame
 * of a glitch, so what is saved is the parameters, and what draws them is CSS in whatever is
 * showing the asset — this editor's preview, the scene preview, the published player. That is
 * why the pane has no Apply and nothing to undo: the live preview beside it IS the result.
 */
export const EffectTool: React.FC<EffectToolProps> = props => {
	const {disabled, effect, onChange} = props;
	const {t} = useTranslation();
	const note = useNote();
	const choice: EffectChoice = effect?.kind === 'glitch' ? 'glitch' : 'none';
	const glitch = effect?.kind === 'glitch' ? effect : undefined;

	function selectChoice(next: EffectChoice) {
		if (next === 'none') {
			onChange(undefined);
			return;
		}

		// Switching back to an effect restores nothing: the parameters went with the
		// `undefined`. Landing on the defaults rather than on silence is the point -- a
		// selector that turns an effect on and shows no change reads as broken.
		if (!glitch) {
			onChange({...GLITCH_DEFAULTS});
		}
	}

	function change(key: keyof Omit<GlitchEffect, 'kind'>, value: number) {
		onChange({...(glitch ?? GLITCH_DEFAULTS), [key]: value});
	}

	return (
		<EditorSection
			detail={
				glitch && !effectIsIdle(glitch)
					? t(`dialogs.assetEditor.effectKind.glitch`)
					: undefined
			}
			icon={<IconBolt />}
			note={note}
			title={t('dialogs.assetEditor.effect')}
		>
			<NoteBody kind="info" note={note}>
				{t('dialogs.assetEditor.effectNote')}
			</NoteBody>
			<div
				aria-label={t('dialogs.assetEditor.effectLabel')}
				className="asset-editor-mask-group"
				role="radiogroup"
			>
				{CHOICES.map(id => (
					<IconButton
						ariaChecked={choice === id}
						disabled={disabled}
						icon={CHOICE_ICONS[id]}
						key={id}
						label={t(`dialogs.assetEditor.effectKind.${id}`)}
						onClick={() => selectChoice(id)}
						role="radio"
						selected={choice === id}
						tooltipLabel={t(`dialogs.assetEditor.effectKindHint.${id}`)}
					/>
				))}
			</div>
			{glitch && (
				<>
					{/* A warning rather than a disabled state: every slider still works, the
					    combination just happens to draw nothing, and the author is one drag
					    away from seeing why. */}
					{effectIsIdle(glitch) && (
						<p className="asset-editor-detail">
							{t('dialogs.assetEditor.effectIdle')}
						</p>
					)}
					<ButtonBar>
						{GLITCH_PRESETS.map(preset => (
							<IconButton
								disabled={disabled}
								icon={PRESET_ICONS[preset.id]}
								key={preset.id}
								label={t(`dialogs.assetEditor.effectPreset.${preset.id}`)}
								onClick={() => onChange({...preset.effect})}
								tooltipLabel={t(
									`dialogs.assetEditor.effectPresetHint.${preset.id}`
								)}
							/>
						))}
					</ButtonBar>
					{GLITCH_KEYS.map(key => (
						<AdjustSlider
							disabled={disabled}
							key={key}
							label={t(`dialogs.assetEditor.effectParam.${key}`)}
							max={GLITCH_RANGES[key].max}
							min={GLITCH_RANGES[key].min}
							onChange={value => change(key, value)}
							resetLabel={t('dialogs.assetEditor.reset')}
							resetTo={GLITCH_DEFAULTS[key]}
							step={GLITCH_RANGES[key].step}
							value={glitch[key]}
						/>
					))}
				</>
			)}
		</EditorSection>
	);
};
