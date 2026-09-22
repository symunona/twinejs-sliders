import type {ImageEdits, TileAxis} from '@sliders/scene-types';
import {
	IconArrowsHorizontal,
	IconArrowsVertical,
	IconRepeat
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../components/control/icon-button';
import {AdjustSlider} from './adjust-slider';
import {NoteBody, useNote} from './editor-note';
import {EditorSection} from './editor-section';
import {drawEdited, outputSize} from './image-edits';
import {TILE_AXES, TILE_RANGE, axisSize, seamWidth} from './tile-edits';

export interface TileToolProps {
	disabled?: boolean;
	edits: ImageEdits;
	onChange: (tile: number) => void;
	onChangeAxis: (axis: TileAxis) => void;
	/** The composed picture, full size: whatever the crop and the cutout have left. */
	source?: CanvasImageSource;
}

/** How big the loop preview is drawn. Two copies of the picture have to fit the pane. */
const PREVIEW_WIDTH = 380;
const PREVIEW_HEIGHT = 220;

/** How far the join ticks reach in from the edges they sit on. */
const TICK = 9;

const AXIS_ICONS: Record<TileAxis, React.ReactNode> = {
	x: <IconArrowsHorizontal />,
	y: <IconArrowsVertical />
};

/**
 * Draws the picture as the reader will meet it: looping, with the join in the middle.
 *
 * The stage canvas cannot answer the only question this tool asks. It shows the whole
 * source with the crop drawn over it, so the two edges being married are at opposite ends
 * of it — and the join between them is not anywhere on screen at all, because it only
 * exists once the picture has wrapped. So the preview here is two copies, offset by half a
 * picture: dead centre is the seam, and everything either side of it is what the reader
 * sees a moment before and after the lap restarts.
 */
function drawLoop(
	target: HTMLCanvasElement,
	source: CanvasImageSource,
	edits: ImageEdits
) {
	const context = target.getContext('2d');

	// Asked for first, so a context this environment will not give up costs nothing: a
	// whole edit would otherwise be rendered into an offscreen canvas and thrown away.
	if (!context) {
		return;
	}

	const scale = Math.min(
		1,
		PREVIEW_WIDTH / Math.max(1, edits.width),
		PREVIEW_HEIGHT / Math.max(1, edits.height)
	);
	const tile = document.createElement('canvas');

	// The real edit, at preview size -- the seam included, since `drawEdited` folds it in.
	drawEdited(source, edits, tile, scale);

	const width = tile.width;
	const height = tile.height;

	if (width < 1 || height < 1) {
		return;
	}

	target.width = width;
	target.height = height;
	context.clearRect(0, 0, width, height);

	// Half a picture each side of the join. Whole pixels, so the two copies meet exactly
	// rather than resampling a blur into the one place that is being judged.
	const vertical = edits.tileAxis === 'y';
	const half = Math.round((vertical ? height : width) / 2);
	const span = vertical ? height : width;

	context.drawImage(tile, vertical ? 0 : -half, vertical ? -half : 0);
	context.drawImage(
		tile,
		vertical ? 0 : span - half,
		vertical ? span - half : 0
	);

	// Ticks at the edges rather than a line along the middle: a marker drawn ON the seam
	// would hide the flaw it is pointing at.
	const seam = span - half;

	context.save();
	context.strokeStyle = 'rgba(255, 0, 0, 0.85)';
	context.lineWidth = 2;
	context.beginPath();

	if (vertical) {
		context.moveTo(0, seam);
		context.lineTo(TICK, seam);
		context.moveTo(width - TICK, seam);
		context.lineTo(width, seam);
	} else {
		context.moveTo(seam, 0);
		context.lineTo(seam, TICK);
		context.moveTo(seam, height - TICK);
		context.lineTo(seam, height);
	}

	context.stroke();
	context.restore();
}

/**
 * The right pane for the Seamless tool: which way the picture loops, how much of it
 * overlaps, and the loop that makes.
 *
 * `scroll_infinite_*` is the endless-walk backdrop — the renderer travels a whole frame and
 * starts over, drawing a second copy one frame ahead so the restart itself is invisible.
 * What it cannot hide is art whose facing edges do not match, which shows up as a jump once
 * per lap. This folds one edge back over the other until they do.
 *
 * The cost is size: the overlap is two strips becoming one, so the picture comes out
 * smaller along whichever axis was folded. That is the whole trade, and it is why the size
 * is written in the header rather than left for someone to discover after saving.
 */
export const TileTool: React.FC<TileToolProps> = props => {
	const {disabled, edits, onChange, onChangeAxis, source} = props;
	const {t} = useTranslation();
	const note = useNote();
	const preview = React.useRef<HTMLCanvasElement>(null);
	const axis: TileAxis = edits.tileAxis ?? 'x';
	const output = outputSize(edits);
	const seam = seamWidth(axisSize(edits, axis), edits.tile);

	React.useEffect(() => {
		if (preview.current && source) {
			drawLoop(preview.current, source, edits);
		}
	}, [edits, source]);

	return (
		<EditorSection
			detail={`${output.width}×${output.height}`}
			icon={<IconRepeat />}
			note={note}
			title={t('dialogs.assetEditor.tile')}
		>
			<NoteBody kind="info" note={note}>
				{t('dialogs.assetEditor.tileNote')}
			</NoteBody>
			<div
				aria-label={t('dialogs.assetEditor.tileAxisLabel')}
				className="asset-editor-mask-group"
				role="radiogroup"
			>
				{TILE_AXES.map(id => (
					<IconButton
						ariaChecked={axis === id}
						disabled={disabled}
						icon={AXIS_ICONS[id]}
						key={id}
						label={t(`dialogs.assetEditor.tileAxis.${id}`)}
						onClick={() => onChangeAxis(id)}
						role="radio"
						selected={axis === id}
						tooltipLabel={t(`dialogs.assetEditor.tileAxisHint.${id}`)}
					/>
				))}
			</div>
			<div className="asset-editor-loop">
				<canvas
					aria-label={t('dialogs.assetEditor.tileSeam')}
					ref={preview}
					role="img"
				/>
				<p className="asset-editor-detail">
					{t('dialogs.assetEditor.tileSeamNote')}
				</p>
			</div>
			<AdjustSlider
				disabled={disabled}
				label={t('dialogs.assetEditor.tileOverlap')}
				max={TILE_RANGE.max}
				min={TILE_RANGE.min}
				onChange={onChange}
				resetLabel={t('dialogs.assetEditor.reset')}
				resetTo={0}
				step={TILE_RANGE.step}
				value={edits.tile ?? 0}
			/>
			<p className="asset-editor-detail">
				{seam > 0
					? t('dialogs.assetEditor.tileCost', {pixels: seam})
					: t('dialogs.assetEditor.tileOff')}
			</p>
		</EditorSection>
	);
};
