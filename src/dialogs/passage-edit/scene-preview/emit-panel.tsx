/**
 * The Particles tab: the selected emitter's knobs, writing the scene's `emit:` over the
 * asset's own numbers. Its own tab, shown only while ONE emitter is selected — the knobs
 * are long, and under the Object tab they pushed the grade sliders out of sight.
 *
 * Same `EmitControls` as the Particles dialog, so a knob means the same in both. Base =
 * the asset's numbers (the particle system's DEFAULTS): a highlighted knob is one this
 * scene overrides. Edit = those defaults, in the dialog; every scene follows except where
 * it overrides. Reset all = drop this scene's overrides (`emit: ~`).
 */

import {IconArrowBackUp, IconPencil} from '@tabler/icons';
import {
	resolveEmit,
	type AssetMeta,
	type AssetResolver,
	type EmitPatch,
	type ParticleSpec,
	type StageEntity
} from '@sliders/scene-types';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/control/icon-button';
import {EmitControls} from '../../sliders-particles/emit-controls';
import {SpritePicker} from '../../sliders-particles/sprite-picker';
import {useAssetLibrary} from '../../sliders-assets/asset-store-context';
import {useDialogsContext} from '../../context';
import {requestParticleFocus} from '../../sliders-particles/particle-focus';
import {SlidersParticlesDialog} from '../../sliders-particles/sliders-particles';

/**
 * The emitter behind an asset name, or undefined when it is not one. `revision` = the
 * library version: an edit to the emitter's defaults (Particles dialog) re-reads it, so
 * the knobs' base and the override highlights follow live.
 */
export function useEmitterSpec(
	assets: AssetResolver,
	ref: string | undefined,
	revision?: number
): ParticleSpec | undefined {
	const [spec, setSpec] = React.useState<{ref: string; spec?: ParticleSpec}>();

	React.useEffect(() => {
		if (!ref) {
			return;
		}

		let cancelled = false;

		assets
			.meta(ref)
			.then(meta => !cancelled && setSpec({ref, spec: meta?.particles}))
			.catch(() => !cancelled && setSpec({ref}));

		return () => {
			cancelled = true;
		};
	}, [assets, ref, revision]);

	return spec && spec.ref === ref ? spec.spec : undefined;
}

export interface EmitPanelProps {
	entity: StageEntity;
	spec: ParticleSpec;
	editable: boolean;
	/** Merge into `emit:`; `null` clears every override. */
	onEmit: (patch: EmitPatch | null) => void;
	/** Why a write would go nowhere, if it would. */
	note?: string;
	/** What the sprite picker offers. Absent hides it. */
	assets?: AssetMeta[];
	/** Open this emitter's asset in the Particles dialog. Absent hides the button. */
	onEditEmitter?: () => void;
	/** Every emitter the story sees: the particle system dropdown. Absent hides it. */
	emitters?: AssetMeta[];
	/** Swap the particle system (`ref:`), by asset name. Absent = dropdown read only. */
	onRef?: (name: string) => void;
}

/** `coll/name` and `name` both name an asset; the list holds bare names. */
function bareName(ref: string): string {
	return ref.split('/').pop() ?? ref;
}

export const EmitPanel: React.FC<EmitPanelProps> = props => {
	const {assets, editable, emitters, entity, note, onEditEmitter, onEmit, onRef, spec} =
		props;
	const {t} = useTranslation();
	const ref = entity.ref;
	const current = emitters?.find(asset => asset.name === bareName(ref));

	return (
		<div className="scene-sidebar-section scene-preview-emit" data-testid="scene-preview-emit">
			<div className="scene-preview-emit-head">
				<span>
					{t('dialogs.passageEdit.scenePreview.emit')}: {entity.id}
				</span>
			</div>
			<div className="scene-preview-emit-system">
				{emitters && (
					<label>
						<span>{t('dialogs.passageEdit.scenePreview.emitPick')}</span>
						<select
							data-testid="scene-preview-emit-system"
							disabled={!editable || !onRef}
							onChange={event => onRef?.(event.target.value)}
							value={current ? current.name : ref}
						>
							{/* Not in the list (unknown name, still loading): keep it shown. */}
							{!current && <option value={ref}>{ref}</option>}
							{emitters.map(asset => (
								<option key={asset.id} value={asset.name}>
									{asset.name}
								</option>
							))}
						</select>
					</label>
				)}
				{onEditEmitter && (
					<IconButton
						icon={<IconPencil />}
						label={t('dialogs.passageEdit.scenePreview.emitEditLabel')}
						onClick={onEditEmitter}
						tooltipLabel={t('dialogs.passageEdit.scenePreview.emitEdit')}
					/>
				)}
			</div>
			<div className="scene-preview-emit-reset">
				<IconButton
					disabled={!editable || !entity.emit}
					icon={<IconArrowBackUp />}
					label={t('dialogs.passageEdit.scenePreview.emitResetAll')}
					onClick={() => onEmit(null)}
					tooltipLabel={t('dialogs.passageEdit.scenePreview.emitReset')}
				/>
			</div>
			{note && <p className="scene-sidebar-empty">{note}</p>}
			{assets && (
				<SpritePicker
					assets={assets}
					base={resolveEmit(spec, undefined).sprite}
					disabled={!editable}
					noneLabel={t('dialogs.passageEdit.scenePreview.emitSpriteOwn')}
					// Undefined drops the key from the merged map: back to the asset's sprite.
					onPick={sprite => onEmit({sprite})}
					value={resolveEmit(spec, entity.emit).sprite}
				/>
			)}
			<EmitControls
				base={resolveEmit(spec, undefined)}
				disabled={!editable}
				onChange={onEmit}
				value={resolveEmit(spec, entity.emit)}
			/>
		</div>
	);
};

/** The panel as the sidebar mounts it: the sprite list comes from the library here. */
export const EmitTab: React.FC<
	Omit<EmitPanelProps, 'assets' | 'emitters' | 'onEditEmitter'>
> = props => {
	const {all} = useAssetLibrary();
	const emitters = React.useMemo(
		() =>
			all
				.filter(asset => asset.particles)
				.sort((a, b) => a.name.localeCompare(b.name)),
		[all]
	);
	const {dispatch} = useDialogsContext();
	const ref = props.entity.ref;

	// No props on the dispatch: the reducer dedupes by props, so an open dialog is raised
	// and the bus switches it (`particle-focus.ts`).
	const editEmitter = React.useCallback(() => {
		requestParticleFocus(ref);
		dispatch({component: SlidersParticlesDialog, type: 'addDialog'});
	}, [dispatch, ref]);

	return (
		<EmitPanel
			{...props}
			assets={all}
			emitters={emitters}
			onEditEmitter={editEmitter}
		/>
	);
};
