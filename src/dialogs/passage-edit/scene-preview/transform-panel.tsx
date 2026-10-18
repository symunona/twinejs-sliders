/**
 * The Transform tab: the selected sprite's `at`, `scale`, `rot` and `z` as numbers.
 *
 * The handles on the stage are for placing by eye; this is for the cases they are bad at —
 * two sprites on exactly the same line, a prop turned exactly 90°, a z between two others.
 * Every box shows the value at the beat on screen and writes through the same keys the
 * handles do (`transform-writes.ts`).
 *
 * One sprite only. A typed x for three sprites would either stack them on one point or
 * need a "shift by" mode, and neither is what a number box promises. The tab says so
 * rather than hiding.
 */

import * as React from 'react';
import {useTranslation} from 'react-i18next';
import type {EntityId, Stage} from '@sliders/scene-types';
import {NumberField} from './number-field';
import {
	TRANSFORM_MAX_ROT,
	TRANSFORM_MAX_SCALE,
	TRANSFORM_MIN_SCALE,
	atAxisWrite,
	derivedZ,
	rotKeyWrite,
	scaleKeyWrite,
	zKeyWrite
} from './transform-writes';
import type {EntityKeyWrite} from './use-scene-writer';
import './beat-props.css';

export interface TransformPanelProps {
	editable: boolean;
	ids: EntityId[];
	/** The stage as AUTHORED: an `of:` child's `at` is its offset, as the YAML says it. */
	authored: Stage;
	/** The stage as DRAWN (`resolveStage`): where y-derived z is measured. */
	drawn: Stage;
	/** Why a write would go somewhere unexpected (a beat about to be inserted). */
	note?: string;
	onWrite: (writes: EntityKeyWrite[]) => void;
}

export const TransformPanel: React.FC<TransformPanelProps> = props => {
	const {authored, drawn, editable, ids, note, onWrite} = props;
	const {t} = useTranslation();
	const id = ids.length === 1 ? ids[0] : undefined;
	const entity = id === undefined ? undefined : authored?.entities?.[id];
	const shown = id === undefined ? undefined : drawn?.entities?.[id];
	const label = (key: string) =>
		t(`dialogs.passageEdit.scenePreview.transform.${key}`);

	if (ids.length > 1) {
		return (
			<div className="scene-sidebar-section" data-testid="transform-panel">
				<p className="scene-sidebar-empty">{label('singleOnly')}</p>
			</div>
		);
	}

	if (!entity || !shown) {
		return null;
	}

	const write = (next: EntityKeyWrite | undefined) => next && onWrite([next]);
	const disabled = !editable;
	// A plane has no box to place, size or turn (the parser warns about all three), so its
	// only number is z.
	const plane = entity.fit !== undefined;

	return (
		<div className="scene-sidebar-section" data-testid="transform-panel">
			<div className="scene-sidebar-heading">{entity.id}</div>
			{note && <p className="scene-sidebar-empty">{note}</p>}
			{plane ? (
				<p className="scene-sidebar-empty">{label('plane')}</p>
			) : (
				<>
					{entity.of !== undefined && (
						<p className="scene-sidebar-empty">
							{t('dialogs.passageEdit.scenePreview.transform.relative', {
								parent: entity.of
							})}
						</p>
					)}
					<div className="scene-sidebar-row" data-testid="transform-at">
						<NumberField
							disabled={disabled}
							label={label('x')}
							onCommit={x => write(atAxisWrite(entity, 'x', x))}
							step={0.01}
							value={entity.at.x}
						/>
						<NumberField
							disabled={disabled}
							label={label('y')}
							onCommit={y => write(atAxisWrite(entity, 'y', y))}
							step={0.01}
							value={entity.at.y}
						/>
					</div>
					<div className="scene-sidebar-row" data-testid="transform-scale">
						<NumberField
							disabled={disabled}
							label={label('scale')}
							max={TRANSFORM_MAX_SCALE}
							min={TRANSFORM_MIN_SCALE}
							onCommit={scale => write(scaleKeyWrite(entity, scale))}
							placeholder="1"
							step={0.05}
							value={entity.scale}
						/>
					</div>
					<div className="scene-sidebar-row" data-testid="transform-rot">
						<NumberField
							disabled={disabled}
							label={label('rot')}
							max={TRANSFORM_MAX_ROT}
							min={-TRANSFORM_MAX_ROT}
							onCommit={rot => write(rotKeyWrite(entity, rot))}
							placeholder="0"
							step={1}
							unit="°"
							value={entity.rot ?? 0}
						/>
					</div>
				</>
			)}
			<div className="scene-sidebar-row" data-testid="transform-z">
				<NumberField
					disabled={disabled}
					label={label('z')}
					onCommit={z => write(zKeyWrite(shown, z))}
					// No `z:` key: the order comes from y, and the box says what that is
					// without claiming it is written.
					placeholder={t('dialogs.passageEdit.scenePreview.transform.zAuto', {
						z: derivedZ(shown)
					})}
					step={0.1}
					value={shown.z}
				/>
			</div>
		</div>
	);
};
