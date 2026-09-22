import {AssetMask, MaskOp} from '@sliders/scene-types';
import {
	IconClearAll,
	IconLayersDifference,
	IconLayersSubtract,
	IconLayersUnion,
	IconPointer,
	IconPolygon,
	IconScissors,
	IconScribble,
	IconTrash
} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../components/control/icon-button';
import {AdjustSlider} from './adjust-slider';
import {NoteBody, useNote} from './editor-note';
import {EditorSection} from './editor-section';
import {
	DEFAULT_FEATHER,
	FEATHER_RANGE,
	MASK_TOOL_IDS,
	MaskMode,
	MaskToolId
} from './mask-shapes';

export interface MaskToolProps {
	mask: AssetMask;
	/**
	 * Which preview the stage is drawing. Read-only here: the switch itself lives in the
	 * toolbar, where `alpha` is also reachable from the background tool. The pane still
	 * needs to know, because the drawing tools do nothing under `rendered`.
	 */
	mode: MaskMode;
	tool: MaskToolId;
	onChangeTool: (tool: MaskToolId) => void;
	selected?: string;
	onSelect: (shapeId: string | undefined) => void;
	onChange: (mask: AssetMask) => void;
	/** Op and feather a NEW shape starts with. */
	op: MaskOp;
	onChangeOp: (op: MaskOp) => void;
	feather: number;
	onChangeFeather: (feather: number) => void;
	disabled?: boolean;
}

const TOOL_ICONS: Record<MaskToolId, React.ReactNode> = {
	edit: <IconPointer />,
	freehand: <IconScribble />,
	polygon: <IconPolygon />
};

/** Subtract area, add area — the same pair the composite does. */
const OP_ICONS: Record<MaskOp, React.ReactNode> = {
	cut: <IconLayersSubtract />,
	keep: <IconLayersUnion />
};

const MASK_OPS: MaskOp[] = ['cut', 'keep'];

/**
 * The right pane for hand-drawn masks: which preview, which gesture, and the shapes
 * already drawn.
 *
 * An `EditorSection` like the others. It carries two radio groups plus a slider where the
 * rest carry one, which is why it is a section rather than more toolbar. The preview mode
 * is the one switch that did NOT stay here: `alpha` is how an author judges the model's
 * own mask, and that question is asked from the background tool, where this pane is not
 * on screen.
 */
export const MaskTool: React.FC<MaskToolProps> = props => {
	const {
		disabled,
		feather,
		mask,
		mode,
		onChange,
		onChangeFeather,
		onChangeOp,
		onChangeTool,
		onSelect,
		op,
		selected,
		tool
	} = props;
	const {t} = useTranslation();
	const note = useNote();
	const shapes = mask.shapes;
	const current = shapes.find(shape => shape.id === selected);

	/**
	 * Op and feather edit the picked shape when there is one, and otherwise set what the
	 * next shape will start with. Two meanings, one pair of controls — so the scope is
	 * written above them. Without it the slider silently does one of two different things
	 * and nothing onscreen says which.
	 */
	const scope = current
		? t('dialogs.assetEditor.maskShapeLabel', {
				index: shapes.indexOf(current) + 1
		  })
		: t('dialogs.assetEditor.maskDefaults');
	const scopeOp = current?.op ?? op;

	function editSelected(change: {
		feather?: number;
		invert?: boolean;
		op?: MaskOp;
	}) {
		onChange({
			shapes: shapes.map(shape =>
				shape.id === selected ? {...shape, ...change} : shape
			)
		});
	}

	function changeOp(next: MaskOp) {
		if (current) {
			editSelected({op: next});
		} else {
			onChangeOp(next);
		}
	}

	/**
	 * Unlike op and feather, this has no default to fall back on: which side a new shape
	 * acts on comes from the direction it was drawn in, so there is nothing to set until
	 * there is a shape. Drawing picks the shape it just made, so the button is live the
	 * moment a stroke finishes — see the disabled hint for the gesture itself.
	 */
	function toggleInvert() {
		if (current) {
			editSelected({invert: !current.invert});
		}
	}

	function changeFeather(next: number) {
		if (current) {
			editSelected({feather: next});
		} else {
			onChangeFeather(next);
		}
	}

	function remove(shapeId: string) {
		onChange({shapes: shapes.filter(shape => shape.id !== shapeId)});

		if (selected === shapeId) {
			onSelect(undefined);
		}
	}

	function clear() {
		onChange({shapes: []});
		onSelect(undefined);
	}

	return (
		<EditorSection
			detail={shapes.length > 0 ? shapes.length : undefined}
			icon={<IconScissors />}
			note={note}
			title={t('dialogs.assetEditor.mask')}
		>
			<NoteBody kind="info" note={note}>
				{t('dialogs.assetEditor.maskNote')}
			</NoteBody>
			<div
				aria-label={t('dialogs.assetEditor.maskToolsLabel')}
				className="asset-editor-mask-group"
				role="radiogroup"
			>
				{MASK_TOOL_IDS.map(id => (
					<IconButton
						ariaChecked={tool === id}
						// The drawing tools do nothing in the rendered preview, where the
						// overlay takes no gestures at all.
						disabled={disabled || mode === 'rendered'}
						icon={TOOL_ICONS[id]}
						iconOnly
						key={id}
						label={t(`dialogs.assetEditor.maskTool.${id}`)}
						onClick={() => onChangeTool(id)}
						role="radio"
						selected={tool === id}
						tooltipLabel={t(`dialogs.assetEditor.maskToolHint.${id}`)}
					/>
				))}
			</div>
			<div
				className={classNames('asset-editor-mask-scope', {shape: !!current})}
				data-testid="mask-scope"
			>
				<span className="asset-editor-mask-scope-label">{scope}</span>
				<div
					// Named by the scope line above it, so a screen reader hears which of
					// the two things these buttons are about to change.
					aria-label={scope}
					className="asset-editor-mask-group"
					role="radiogroup"
				>
					{MASK_OPS.map(id => (
						<IconButton
							ariaChecked={scopeOp === id}
							disabled={disabled}
							icon={OP_ICONS[id]}
							iconOnly
							key={id}
							label={t(`dialogs.assetEditor.maskOp.${id}`)}
							onClick={() => changeOp(id)}
							role="radio"
							selected={scopeOp === id}
						/>
					))}
				</div>
				{/* Outside the radiogroup on purpose: cut and keep are a choice of one,
				    and this is a toggle on top of whichever of them is picked. */}
				<IconButton
					disabled={disabled || !current}
					icon={<IconLayersDifference />}
					iconOnly
					label={t('dialogs.assetEditor.maskInvert')}
					onClick={toggleInvert}
					selectable
					selected={!!current?.invert}
					tooltipLabel={t(
						current
							? 'dialogs.assetEditor.maskInvertHint'
							: 'dialogs.assetEditor.maskInvertDrawHint'
					)}
				/>
				<AdjustSlider
					disabled={disabled}
					label={t('dialogs.assetEditor.maskFeather')}
					max={FEATHER_RANGE.max}
					min={FEATHER_RANGE.min}
					onChange={changeFeather}
					resetLabel={t('dialogs.assetEditor.reset')}
					resetTo={DEFAULT_FEATHER}
					step={FEATHER_RANGE.step}
					value={current?.feather ?? feather}
				/>
			</div>
			{shapes.length === 0 ? (
				<p className="asset-editor-hint">{t('dialogs.assetEditor.maskEmpty')}</p>
			) : (
				<ul
					aria-label={t('dialogs.assetEditor.maskShapes')}
					className="asset-editor-mask-list"
				>
					{shapes.map((shape, index) => (
						<li
							className={classNames('asset-editor-mask-row', {
								selected: shape.id === selected
							})}
							data-invert={shape.invert ? 'true' : undefined}
							data-op={shape.op}
							data-shape-id={shape.id}
							data-testid="mask-row"
							key={shape.id}
						>
							<IconButton
								disabled={disabled}
								icon={OP_ICONS[shape.op]}
								// A different string, not a suffix on the same one: which
								// side a shape acts on is the thing hardest to read off
								// the stage, and it is the only place the list says it.
								label={t(
									shape.invert
										? 'dialogs.assetEditor.maskShapeOutsideLabel'
										: 'dialogs.assetEditor.maskShapeLabel',
									{index: index + 1}
								)}
								// Clicking the picked row puts it down again: there is no
								// other way back to "these controls set the next shape".
								onClick={() =>
									onSelect(shape.id === selected ? undefined : shape.id)
								}
								selectable
								selected={shape.id === selected}
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
			<IconButton
				disabled={disabled || shapes.length === 0}
				icon={<IconClearAll />}
				label={t('dialogs.assetEditor.maskClear')}
				onClick={clear}
				variant="danger"
			/>
		</EditorSection>
	);
};
