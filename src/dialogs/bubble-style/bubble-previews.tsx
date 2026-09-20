/**
 * The swatches and the option lists behind every bubble dropdown.
 *
 * ONE module, because there are two places an author picks a bubble style — the story's
 * Defaults dialog and the beat row in the scene editor — and they are the same choice with
 * a different scope. A second list would drift the moment a shape is added: the editor
 * would offer it and the defaults would not, or the two would disagree about what `yell`
 * looks like. `ARCHITECTURE.md` calls this out as the recurring cause of editor/player
 * disagreement, and a dropdown is no different.
 *
 * The previews are the REAL thing, not drawings of it:
 *
 *   - A shape swatch calls `bubbleShape()`, the same pure function the renderer calls, and
 *     drops its SVG in. A shape that changes changes here.
 *   - A preset swatch is a `.sliders-bubble` with the preset's own `data-style`, painted by
 *     the renderer's own stylesheet. Same rule, smaller box.
 *
 * `dangerouslySetInnerHTML` on the shape SVG is safe by the shape module's own contract: it
 * sanitises every colour it is handed (`cssColour`) precisely because those strings arrive
 * from story YAML, and the rest of the markup is its own.
 */

import * as React from 'react';
import {
	BUBBLE_FONTS,
	BUBBLE_PRESETS,
	BUBBLE_SHAPES,
	bubbleFontStack
} from '@sliders/scene-types';
import {bubbleShape, injectStyles} from '@sliders/render-dom';
import type {PreviewSelectOption} from '../../components/control/preview-select';

/** The swatch box, in px. Matches `.bubble-style-preview` in `preview-select.css`. */
const SWATCH = {width: 56, height: 30};

/**
 * The bubble box a shape is drawn into, inset inside the swatch.
 *
 * A shape draws OUTSIDE its box — a tail, an outline, a slab, up to its own `margin` — and
 * the swatch clips. Asking for a box the size of the swatch would therefore crop every
 * outline; asking for this one leaves the margin room to land inside.
 */
const SHAPE_BOX = {width: 38, height: 18};

/**
 * Where the preview's tail points, in bubble-local px.
 *
 * Below and slightly left, which is where a tail goes when a character is standing under
 * their own line — the common case, and the one that makes the shape recognisable.
 */
const SHAPE_ANCHOR = {x: SHAPE_BOX.width * 0.3, y: SHAPE_BOX.height + 8};

/** A fixed seed, so a swatch does not re-wobble every time the list opens. */
const SHAPE_SEED = 0x5e1d;

export interface BubbleSwatchColors {
	/** Fill. Falls back to the renderer's own default. */
	bg?: string;
	/** Outline or second colour. Falls back to the renderer's own default. */
	accent?: string;
	/** Text colour, for the preset swatches. */
	color?: string;
	/** Font stack or catalogue token, for the preset swatches. */
	font?: string;
}

/**
 * One `as:` token, drawn.
 *
 * Colours are threaded through so the Defaults dialog's own bg and stroke show up in the
 * style list: an author who has set a red bubble wants to choose a SHAPE against red, not
 * against the factory white.
 */
export const BubbleStyleSwatch: React.FC<
	{token: string} & BubbleSwatchColors
> = ({accent, bg, color, font, token}) => {
	// The presets are painted by the renderer's stylesheet, which nothing has injected if
	// this dialog opened before any preview did.
	React.useEffect(() => injectStyles(), []);

	const drawn = React.useMemo(
		() =>
			bubbleShape(token, {
				...SHAPE_BOX,
				anchor: SHAPE_ANCHOR,
				side: 'above',
				// Empty, not a colour of our own, whenever the author has stated none. Each
				// shape carries its OWN default pair and they are not interchangeable —
				// `shard`'s accent is a cyan plate, `comic`'s is near-black ink. Substituting
				// one flat "unset" colour for both painted shard's plate black on a black
				// swatch, i.e. drew nothing.
				color: bg ?? '',
				accent: accent ?? '',
				seed: SHAPE_SEED
			}),
		[accent, bg, token]
	);

	return (
		<span className="bubble-style-preview" style={SWATCH}>
			<span className="bubble-style-preview-inner">
				{drawn ? (
					/*
					 * The SVG lays itself out: it is already box + margin on every side, and
					 * the flex parent centres it. Its own inline `left`/`top` are for the
					 * dialogue layer, which positions it absolutely — here they are inert,
					 * and a wrapper sized to the box alone would crop the margin the drawing
					 * needs.
					 */
					<span dangerouslySetInnerHTML={{__html: drawn.svg}} />
				) : (
					<span
						className="sliders-bubble"
						data-style={token || undefined}
						style={{
							['--sliders-bubble-bg' as string]: bg || undefined,
							['--sliders-bubble-color' as string]: color || undefined,
							['--sliders-bubble-font' as string]: bubbleFontStack(font)
						}}
					>
						Abc
					</span>
				)}
			</span>
		</span>
	);
};

/** A font swatch: the face's own name, set in the face. */
export const BubbleFontSwatch: React.FC<{stack?: string; label: string}> = ({
	label,
	stack
}) => (
	<span className="bubble-font-preview" style={{fontFamily: stack}}>
		{label}
	</span>
);

/**
 * The `as:` list, drawn shapes before CSS presets.
 *
 * Shapes lead because they are what most authors open this dropdown for, and because they
 * change the bubble rather than restyling its text — the bigger decision goes first.
 *
 * `emptyLabel` is the option that writes nothing. Its meaning differs by caller — "no
 * story default" in the Defaults dialog, "inherit whatever is wider" on a beat — so the
 * caller words it, and `emptyPreview` lets the beat row show what it would inherit.
 */
export function bubbleStyleOptions(options: {
	colors?: BubbleSwatchColors;
	emptyLabel: string;
	emptyDetail?: string;
	emptyPreview?: React.ReactNode;
}): PreviewSelectOption[] {
	const {colors, emptyDetail, emptyLabel, emptyPreview} = options;

	return [
		{
			detail: emptyDetail,
			label: emptyLabel,
			preview: emptyPreview,
			value: ''
		},
		...BUBBLE_SHAPES.map(shape => ({
			label: shape,
			preview: <BubbleStyleSwatch token={shape} {...colors} />,
			value: shape
		})),
		...BUBBLE_PRESETS.map(preset => ({
			label: preset,
			preview: <BubbleStyleSwatch token={preset} {...colors} />,
			value: preset
		}))
	];
}

/**
 * The `font:` list.
 *
 * The author's own hand-written stack, if they have one, is kept as an option at the end
 * rather than silently replaced by the nearest catalogue face — `font:` has always taken a
 * raw CSS stack and a dropdown that could not show the value already in the file would
 * clear it the first time it was touched.
 */
export function bubbleFontOptions(options: {
	current?: string;
	emptyLabel: string;
	emptyDetail?: string;
	emptyPreview?: React.ReactNode;
	customLabel: string;
}): PreviewSelectOption[] {
	const {current, customLabel, emptyDetail, emptyLabel, emptyPreview} = options;
	const known = BUBBLE_FONTS.some(font => font.id === current);
	const custom = current && !known ? current : undefined;

	return [
		{
			detail: emptyDetail,
			label: emptyLabel,
			preview: emptyPreview,
			value: ''
		},
		...BUBBLE_FONTS.map(font => ({
			label: font.label,
			preview: <BubbleFontSwatch label={font.label} stack={font.stack} />,
			value: font.id
		})),
		...(custom
			? [
					{
						detail: customLabel,
						label: custom,
						preview: <BubbleFontSwatch label="Abc" stack={custom} />,
						value: custom
					}
			  ]
			: [])
	];
}
