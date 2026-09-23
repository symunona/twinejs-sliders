import {defaultWalkDepth} from '@sliders/scene-core';
import {WALK_OPS, WalkArea, WalkDepth, WalkOp} from '@sliders/scene-types';
import {
	IconClearAll,
	IconShoe,
	IconLayersSubtract,
	IconLayersUnion,
	IconPointer,
	IconPolygon,
	IconScribble,
	IconTrash,
	IconWalk
} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../components/container/button-bar';
import {CheckboxButton} from '../../components/control/checkbox-button';
import {IconButton} from '../../components/control/icon-button';
import {TextSelect} from '../../components/control/text-select';
import {clampDepthScale} from './depth-gizmo';
import {NoteBody, useNote} from './editor-note';
import {EditorSection} from './editor-section';
import {MASK_TOOL_IDS, MaskToolId} from './mask-shapes';
import {WalkEditor} from './use-walk-editor';
import {frameToBaked, frameToSource, WalkFrame} from './walk-shapes';

export interface WalkToolProps {
	/** SOURCE fractions. */
	walk: WalkArea;
	onChange: (walk: WalkArea) => void;
	editor: WalkEditor;
	frame: WalkFrame;
	disabled?: boolean;
	/** Why walk-here is off, when it is. */
	walkHereBlocked?: string;
}

const TOOL_ICONS: Record<MaskToolId, React.ReactNode> = {
	edit: <IconPointer />,
	freehand: <IconScribble />,
	polygon: <IconPolygon />
};

const OP_ICONS: Record<WalkOp, React.ReactNode> = {
	block: <IconLayersSubtract />,
	walk: <IconLayersUnion />
};

/**
 * The walk tool's pane: which gesture, floor or hole, the shapes drawn, the depth lines,
 * the ghost and walk-here.
 *
 * Shaped like the mask pane on purpose — same three gestures, same list — because it is
 * the same drawing with a different meaning.
 */
export const WalkTool: React.FC<WalkToolProps> = props => {
	const {disabled, editor, frame, onChange, walk} = props;
	const {t} = useTranslation();
	const note = useNote();
	const shapes = walk.shapes;
	const current = shapes.find(shape => shape.id === editor.selected);
	const scopeOp = current?.op ?? editor.op;

	function changeOp(next: WalkOp) {
		if (current) {
			onChange({
				...walk,
				shapes: shapes.map(shape =>
					shape.id === current.id ? {...shape, op: next} : shape
				)
			});
		} else {
			editor.setOp(next);
		}
	}

	function remove(id: string) {
		onChange({...walk, shapes: shapes.filter(shape => shape.id !== id)});

		if (editor.selected === id) {
			editor.setSelected(undefined);
		}
	}

	/** Depth lines start round the floor, measured on the picture a save bakes. */
	function toggleDepth(on: boolean) {
		if (!on) {
			onChange({shapes: walk.shapes});
			return;
		}

		const baked = defaultWalkDepth({
			shapes: shapes.map(shape => ({
				...shape,
				points: shape.points.map(p => frameToBaked(frame, p))
			}))
		});
		const y = (value: number) =>
			Math.round(frameToSource(frame, {x: 0, y: value}).y * 1000) / 1000;

		onChange({
			...walk,
			depth: {
				far: {...baked.far, y: y(baked.far.y)},
				near: {...baked.near, y: y(baked.near.y)}
			}
		});
	}

	function changeDepth(line: keyof WalkDepth, key: 'y' | 'scale', value: number) {
		if (!walk.depth || !Number.isFinite(value)) {
			return;
		}

		onChange({
			...walk,
			depth: {
				...walk.depth,
				[line]: {
					...walk.depth[line],
					[key]: key === 'scale' ? clampDepthScale(value) : value
				}
			}
		});
	}

	const noWalkPose =
		!!editor.ghost && !editor.ghost.poses?.walk && editor.walkHere;

	return (
		<EditorSection
			detail={shapes.length > 0 ? shapes.length : undefined}
			icon={<IconShoe />}
			note={note}
			title={t('dialogs.assetEditor.walk.title')}
		>
			<NoteBody kind="info" note={note}>
				{t('dialogs.assetEditor.walk.note')}
			</NoteBody>
			<div
				aria-label={t('dialogs.assetEditor.maskToolsLabel')}
				className="asset-editor-mask-group"
				role="radiogroup"
			>
				{MASK_TOOL_IDS.map(id => (
					<IconButton
						ariaChecked={editor.tool === id}
						disabled={disabled || editor.walkHere}
						icon={TOOL_ICONS[id]}
						iconOnly
						key={id}
						label={t(`dialogs.assetEditor.maskTool.${id}`)}
						onClick={() => editor.setTool(id)}
						role="radio"
						selected={editor.tool === id}
						tooltipLabel={t(`dialogs.assetEditor.maskToolHint.${id}`)}
					/>
				))}
			</div>
			<div
				className={classNames('asset-editor-mask-scope', {shape: !!current})}
				data-testid="walk-scope"
			>
				<span className="asset-editor-mask-scope-label">
					{current
						? t('dialogs.assetEditor.maskShapeLabel', {
								index: shapes.indexOf(current) + 1
						  })
						: t('dialogs.assetEditor.maskDefaults')}
				</span>
				<div className="asset-editor-mask-group" role="radiogroup">
					{WALK_OPS.map(id => (
						<IconButton
							ariaChecked={scopeOp === id}
							disabled={disabled}
							icon={OP_ICONS[id]}
							key={id}
							label={t(`dialogs.assetEditor.walk.op.${id}`)}
							onClick={() => changeOp(id)}
							role="radio"
							selected={scopeOp === id}
							tooltipLabel={t(`dialogs.assetEditor.walk.opHint.${id}`)}
						/>
					))}
				</div>
			</div>
			{shapes.length === 0 ? (
				<p className="asset-editor-hint">{t('dialogs.assetEditor.walk.empty')}</p>
			) : (
				<ul
					aria-label={t('dialogs.assetEditor.maskShapes')}
					className="asset-editor-mask-list"
				>
					{shapes.map((shape, index) => (
						<li
							className={classNames('asset-editor-mask-row', {
								selected: shape.id === editor.selected
							})}
							data-op={shape.op}
							data-shape-id={shape.id}
							data-testid="walk-row"
							key={shape.id}
						>
							<IconButton
								disabled={disabled}
								icon={OP_ICONS[shape.op]}
								label={t('dialogs.assetEditor.walk.shapeLabel', {
									index: index + 1,
									op: t(`dialogs.assetEditor.walk.op.${shape.op}`)
								})}
								onClick={() =>
									editor.setSelected(
										shape.id === editor.selected ? undefined : shape.id
									)
								}
								selectable
								selected={shape.id === editor.selected}
							/>
							<IconButton
								disabled={disabled}
								icon={<IconTrash />}
								iconOnly
								label={t('dialogs.assetEditor.maskDelete')}
								onClick={() => remove(shape.id)}
								variant="danger"
							/>
						</li>
					))}
				</ul>
			)}
			<ButtonBar>
				<CheckboxButton
					disabled={disabled}
					label={t('dialogs.assetEditor.walk.depth')}
					onChange={toggleDepth}
					value={!!walk.depth}
				/>
				<IconButton
					disabled={disabled || shapes.length === 0}
					icon={<IconClearAll />}
					label={t('dialogs.assetEditor.maskClear')}
					onClick={() => {
						onChange({...walk, shapes: []});
						editor.setSelected(undefined);
					}}
					variant="danger"
				/>
			</ButtonBar>
			{walk.depth && (
				<div className="walk-depth-fields" data-testid="walk-depth-fields">
					{(['far', 'near'] as const).map(line => (
						<div className="asset-editor-size" key={line}>
							<label className="asset-editor-number">
								<span>
									{t('dialogs.assetEditor.walk.depthY', {
										line: t(`dialogs.assetEditor.walk.depthLine.${line}`)
									})}
								</span>
								<input
									disabled={disabled}
									onChange={event =>
										changeDepth(line, 'y', Number(event.target.value))
									}
									step={0.01}
									type="number"
									value={walk.depth![line].y}
								/>
							</label>
							<label className="asset-editor-number">
								<span>
									{t('dialogs.assetEditor.walk.depthScale', {
										line: t(`dialogs.assetEditor.walk.depthLine.${line}`)
									})}
								</span>
								<input
									disabled={disabled}
									max={4}
									min={0.05}
									onChange={event =>
										changeDepth(line, 'scale', Number(event.target.value))
									}
									step={0.05}
									type="number"
									value={walk.depth![line].scale}
								/>
							</label>
						</div>
					))}
				</div>
			)}
			<TextSelect
				disabled={disabled || editor.characters.length === 0}
				onChange={event => editor.setGhostId(event.target.value || undefined)}
				options={
					editor.characters.length === 0
						? [{label: t('dialogs.assetEditor.walk.noCharacters'), value: ''}]
						: editor.characters.map(character => ({
								label: character.name || character.id,
								value: character.id
						  }))
				}
				value={editor.ghostId ?? ''}
			>
				{t('dialogs.assetEditor.walk.ghost')}
			</TextSelect>
			<ButtonBar>
				<IconButton
					commandId="assetEditor.walkHere"
					disabled={disabled || !editor.ghost || !!props.walkHereBlocked}
					icon={<IconWalk />}
					label={t('dialogs.assetEditor.walk.walkHere')}
					onClick={() => editor.setWalkHere(!editor.walkHere)}
					selectable
					selected={editor.walkHere}
				/>
			</ButtonBar>
			<p className="asset-editor-hint">
				{t(
					editor.walkHere
						? 'dialogs.assetEditor.walk.walkHereHint'
						: 'dialogs.assetEditor.walk.ghostHint'
				)}
			</p>
			{props.walkHereBlocked && (
				<p className="asset-editor-detail">{props.walkHereBlocked}</p>
			)}
			{noWalkPose && (
				<p className="asset-editor-detail" data-testid="walk-no-pose">
					{t('dialogs.assetEditor.walk.noWalkPose')}
				</p>
			)}
			{editor.path && !editor.path.reached && (
				<p className="asset-editor-detail" data-testid="walk-unreachable">
					{t('dialogs.assetEditor.walk.unreachable')}
				</p>
			)}
		</EditorSection>
	);
};
