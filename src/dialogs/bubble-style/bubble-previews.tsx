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

/**
 * The word every swatch is lettered with.
 *
 * Three letters with an ascender, a round and a descender-free baseline: enough to tell
 * Bangers from Patrick Hand at 9px, short enough to fit the smallest shape's interior.
 * Deliberately not localised — it is a type specimen, not a sentence.
 */
const SAMPLE = 'Abc';

/** The demo bubble's box, in px. Roughly a line of dialogue on a small stage. */
const DEMO_BOX = {width: 232, height: 62};

/** Below and left, where a tail goes when the speaker stands under their own line. */
const DEMO_ANCHOR = {x: DEMO_BOX.width * 0.28, y: DEMO_BOX.height + 26};

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
					 *
					 * The word sits OVER it, absolutely, rather than inside the drawing. A
					 * shape emits no text — it is a picture of a container — so without this
					 * the font and the text colour had nowhere to show, and picking `comic`
					 * told the author nothing about what their words would look like in it.
					 * Centred rather than laid out against the shape's own `padding`: at
					 * swatch scale the padding is a pixel or two and the word is three
					 * letters, so honouring it would only push the sample off centre.
					 */
					<>
						<span dangerouslySetInnerHTML={{__html: drawn.svg}} />
						<span
							className="bubble-style-preview-word"
							style={{
								color: color || undefined,
								fontFamily: bubbleFontStack(font)
							}}
						>
							{SAMPLE}
						</span>
					</>
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
						{SAMPLE}
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

/**
 * The demo bubble: a whole line, at a size you can actually read.
 *
 * The dropdown swatches are 56x30 and answer "which one is this?". They cannot answer the
 * question an author asks after picking — "is this readable?" — because at thumbnail size
 * everything is. A yellow fill under a white text colour, a face whose lowercase is too
 * loose at body size, a shape whose padding eats a long line: all three look fine as a
 * swatch and wrong as a line of dialogue.
 *
 * So this draws one line the way the renderer would, at the size the renderer would:
 *
 *   - the SAME `bubbleShape()` call, so the outline is the real one;
 *   - the shape's OWN `padding`, honoured, which is the thing the swatches drop — a cloud
 *     keeps its words far further inside than a panel does, and that is most of why a line
 *     fits one shape and not another;
 *   - stub text rather than the author's, because there is no "current line" at story
 *     level and a made-up sentence of ordinary length is what a default is chosen against.
 *
 * On the letterbox fill, not on the dialog's own background: a bubble is always read
 * against art, and judging a pale fill against a white panel is judging it against the one
 * background it will never appear on.
 */
export const BubbleStyleDemo: React.FC<
	{text: string} & BubbleSwatchColors & {token?: string}
> = ({accent, bg, color, font, text, token}) => {
	React.useEffect(() => injectStyles(), []);

	const drawn = React.useMemo(
		() =>
			bubbleShape(token, {
				...DEMO_BOX,
				anchor: DEMO_ANCHOR,
				side: 'above',
				color: bg ?? '',
				accent: accent ?? '',
				seed: SHAPE_SEED
			}),
		[accent, bg, token]
	);
	const type = {
		color: color || undefined,
		fontFamily: bubbleFontStack(font)
	};

	return (
		<div className="bubble-style-demo">
			{drawn ? (
				<div
					className="bubble-style-demo-shape"
					style={{height: DEMO_BOX.height, width: DEMO_BOX.width}}
				>
					<span dangerouslySetInnerHTML={{__html: drawn.svg}} />
					<span
						className="bubble-style-demo-text"
						style={{
							...type,
							// The shape's own statement of where words are safe. Only the
							// shape knows: a cloud needs far more than a panel.
							padding: `${drawn.padding.top}px ${drawn.padding.right}px ${drawn.padding.bottom}px ${drawn.padding.left}px`
						}}
					>
						{text}
					</span>
				</div>
			) : (
				<span
					className="sliders-bubble"
					data-style={token || undefined}
					style={{
						['--sliders-bubble-bg' as string]: bg || undefined,
						['--sliders-bubble-color' as string]: color || undefined,
						['--sliders-bubble-font' as string]: bubbleFontStack(font),
						maxWidth: DEMO_BOX.width
					}}
				>
					{text}
				</span>
			)}
		</div>
	);
};
