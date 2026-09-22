import type {ImageEdits} from '@sliders/scene-types';
import {IconRepeat} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {AdjustSlider} from './adjust-slider';
import {NoteBody, useNote} from './editor-note';
import {EditorSection} from './editor-section';
import {drawEdited, outputSize} from './image-edits';
import {TILE_RANGE, seamWidth} from './tile-edits';

export interface TileToolProps {
	disabled?: boolean;
	edits: ImageEdits;
	onChange: (tile: number) => void;
	/** The composed picture, full size: whatever the crop and the cutout have left. */
	source?: CanvasImageSource;
}

/** How big the loop preview is drawn. Two copies of the picture have to fit the pane. */
const PREVIEW_WIDTH = 380;
const PREVIEW_HEIGHT = 220;

/** How far the join ticks reach in from the top and bottom edges. */
const TICK = 9;

/**
 * Draws the picture as the reader will meet it: looping, with the join in the middle.
 *
 * The stage canvas cannot answer the only question this tool asks. It shows the whole
 * source with the crop drawn over it, so the two edges being married are at opposite ends
 * of it — and the join between them is not anywhere on screen at all, because it only
 * exists once the picture has wrapped. So the preview here is two copies side by side,
 * offset by half a width: dead centre is the seam, and everything either side of it is
 * what the reader sees a moment before and after the lap restarts.
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
	const half = Math.round(width / 2);

	context.drawImage(tile, -half, 0);
	context.drawImage(tile, width - half, 0);

	// Ticks at the edges rather than a line down the middle: a marker drawn ON the seam
	// would hide the flaw it is pointing at.
	context.save();
	context.strokeStyle = 'rgba(255, 0, 0, 0.85)';
	context.lineWidth = 2;
	context.beginPath();
	context.moveTo(width - half, 0);
	context.lineTo(width - half, TICK);
	context.moveTo(width - half, height - TICK);
	context.lineTo(width - half, height);
	context.stroke();
	context.restore();
}

/**
 * The right pane for the Seamless tool: one slider, and the loop it makes.
 *
 * `scroll_infinite_*` is the endless-walk backdrop — the renderer travels a whole frame and
 * starts over, drawing a second copy one frame ahead so the restart itself is invisible.
 * What it cannot hide is art whose left and right edges do not match, which shows up as a
 * jump once per lap. This folds the right edge back over the left until they do.
 *
 * The cost is width: the overlap is two strips becoming one, so the picture comes out
 * narrower. That is the whole trade, and it is why the size is written in the header rather
 * than left for someone to discover after saving.
 */
export const TileTool: React.FC<TileToolProps> = props => {
	const {disabled, edits, onChange, source} = props;
	const {t} = useTranslation();
	const note = useNote();
	const preview = React.useRef<HTMLCanvasElement>(null);
	const output = outputSize(edits);
	const seam = seamWidth(edits.width, edits.tile);

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
					? t('dialogs.assetEditor.tileCost', {
							pixels: seam,
							width: output.width
					  })
					: t('dialogs.assetEditor.tileOff')}
			</p>
		</EditorSection>
	);
};
