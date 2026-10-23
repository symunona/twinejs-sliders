/**
 * The Particles tab: the selected emitter's knobs, writing the scene's `emit:` over the
 * asset's own numbers. Its own tab, shown only while ONE emitter is selected — the knobs
 * are long, and under the Object tab they pushed the grade sliders out of sight.
 *
 * Same `EmitControls` as the Particles dialog, so a knob means the same in both. Base =
 * the asset's numbers: a highlighted knob is one this scene overrides.
 */

import {IconArrowBackUp} from '@tabler/icons';
import {
	resolveEmit,
	type AssetResolver,
	type EmitPatch,
	type ParticleSpec,
	type StageEntity
} from '@sliders/scene-types';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/control/icon-button';
import {EmitControls} from '../../sliders-particles/emit-controls';

/** The emitter behind an asset name, or undefined when it is not one. */
export function useEmitterSpec(
	assets: AssetResolver,
	ref: string | undefined
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
	}, [assets, ref]);

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
}

export const EmitPanel: React.FC<EmitPanelProps> = props => {
	const {editable, entity, note, onEmit, spec} = props;
	const {t} = useTranslation();

	return (
		<div className="scene-sidebar-section scene-preview-emit" data-testid="scene-preview-emit">
			<div className="scene-preview-emit-head">
				<span>
					{t('dialogs.passageEdit.scenePreview.emit')}: {entity.id}
				</span>
				<IconButton
					disabled={!editable || !entity.emit}
					icon={<IconArrowBackUp />}
					iconOnly
					label={t('dialogs.passageEdit.scenePreview.emitReset')}
					onClick={() => onEmit(null)}
				/>
			</div>
			{note && <p className="scene-sidebar-empty">{note}</p>}
			<EmitControls
				base={resolveEmit(spec, undefined)}
				disabled={!editable}
				onChange={onEmit}
				value={resolveEmit(spec, entity.emit)}
			/>
		</div>
	);
};
