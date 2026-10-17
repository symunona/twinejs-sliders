/**
 * The `sizing:` dropdown's explanations: a phone and a desktop, side by side, each showing
 * the same line drawn under one sizing.
 *
 * `sizing:` is a BEHAVIOUR, not a look — what it changes is how a bubble answers a smaller
 * or larger screen — so a swatch cannot say it and the three words alone did not. The
 * figure is a small model of the renderer, not a drawing of an idea:
 *
 *   - `auto`: type is a fixed px size (`.sliders-dialogue` 16px), the box wraps the words
 *     with its width capped at 42% of the stage. On a phone the same words take more lines
 *     and a bigger share of the picture.
 *   - `absolute`: box is `w` x `h` of the stage and the type is fitted to it from a base
 *     that is a fraction of the stage height (`fitText`, `ABSOLUTE_TEXT`). The phone shows
 *     the desktop picture, smaller.
 *   - `manual`: same stage-fraction box, type left at its fixed px size. What does not fit
 *     is clipped — on a phone, usually the end of the line.
 *
 * Constants mirror `packages/render-dom/src/dialogue.ts` and `styles.ts`. Units are CSS px
 * divided by ten, with the fixed type drawn about twice true size so it reads at all
 * at this scale — the direction of every difference is the renderer's.
 */

import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {BUBBLE_SIZINGS, BubbleSizing} from '@sliders/scene-types';
import type {PreviewSelectOption} from '../../components/control/preview-select';
import './bubble-sizing.css';

export interface SizingStage {
	width: number;
	height: number;
}

/** A landscape phone's stage and a desktop's, in figure units (~CSS px / 10). */
export const PHONE_STAGE: SizingStage = {width: 80, height: 45};
export const DESKTOP_STAGE: SizingStage = {width: 160, height: 90};

/** The fixed type size `auto` and `manual` keep on every screen, in figure units. */
const FIXED_FONT = 3;

/** `.sliders-dialogue`'s line-height. */
const LINE_HEIGHT = 1.4;

/** Average glyph advance, as a fraction of the font size. */
const CHAR_WIDTH = 0.55;

/** `max-width: 42%` on `.sliders-bubble`. */
const AUTO_MAX_W = 0.42;

/** `padding: 10px 14px`, in figure units. */
const AUTO_PAD = {x: 1.4, y: 1};

/** The rectangle the two fixed sizings state, as stage fractions — a caption panel. */
const FIXED_W = 0.42;
const FIXED_H = 0.2;

/** `PAD_Y`, `PAD_X`, `ABSOLUTE_TEXT`, `FIT_MIN`, `FIT_MAX` from `dialogue.ts`. */
const PAD_Y = 10 / 900;
const PAD_X = 14 / 900;
const ABSOLUTE_TEXT = 0.055;
const FIT_MIN = 0.25;
const FIT_MAX = 2.4;

/** The sample line, as word lengths in characters. About seventy characters. */
const WORDS = [2, 4, 4, 2, 6, 3, 1, 5, 4, 2, 3, 5, 3, 4, 2, 6];

export interface SizingLine {
	/** Word segments on this line, as [x, width] relative to the box's text origin. */
	words: [number, number][];
}

export interface SizingLayout {
	/** The bubble rectangle, in stage units. */
	box: {x: number; y: number; width: number; height: number};
	font: number;
	pad: {x: number; y: number};
	lines: SizingLine[];
	/** Lines past this index fall outside the box and are clipped. */
	visibleLines: number;
}

/** Greedy wrap, the way a browser breaks a line between words. */
export function wrapWords(font: number, maxWidth: number): SizingLine[] {
	const char = font * CHAR_WIDTH;
	const lines: SizingLine[] = [];
	let line: [number, number][] = [];
	let x = 0;

	for (const length of WORDS) {
		const width = length * char;

		if (line.length > 0 && x + width > maxWidth) {
			lines.push({words: line});
			line = [];
			x = 0;
		}

		line.push([x, width]);
		x += width + char;
	}

	lines.push({words: line});

	return lines;
}

function lineWidth(line: SizingLine): number {
	const last = line.words[line.words.length - 1];

	return last ? last[0] + last[1] : 0;
}

/**
 * Where the bubble lands on a stage of this size under this sizing, and what its words do.
 *
 * Pure, so the test can hold the figure to the renderer's behaviour without a browser.
 */
export function layoutSizing(
	sizing: BubbleSizing,
	stage: SizingStage
): SizingLayout {
	const left = stage.width * 0.1;
	const top = stage.height * 0.12;

	if (sizing === 'auto') {
		const pad = AUTO_PAD;
		const lines = wrapWords(FIXED_FONT, stage.width * AUTO_MAX_W - pad.x * 2);
		const width = Math.max(...lines.map(lineWidth)) + pad.x * 2;
		const height = lines.length * FIXED_FONT * LINE_HEIGHT + pad.y * 2;

		return {
			box: {x: left, y: top, width, height},
			font: FIXED_FONT,
			lines,
			pad,
			visibleLines: lines.length
		};
	}

	const width = stage.width * FIXED_W;
	const height = stage.height * FIXED_H;
	const pad = {x: stage.height * PAD_X, y: stage.height * PAD_Y};
	const innerW = width - pad.x * 2;
	const innerH = height - pad.y * 2;
	const fits = (font: number) => {
		const lines = wrapWords(font, innerW);

		return (
			lines.length * font * LINE_HEIGHT <= innerH &&
			Math.max(...lines.map(lineWidth)) <= innerW
		);
	};
	let font = FIXED_FONT;

	if (sizing === 'absolute') {
		// `fitText`: the largest size in [base * FIT_MIN, base * FIT_MAX] that fits.
		const base = stage.height * ABSOLUTE_TEXT;
		let lo = base * FIT_MIN;
		let hi = base * FIT_MAX;

		if (fits(hi)) {
			lo = hi;
		} else {
			for (let i = 0; i < 12; i++) {
				const mid = (lo + hi) / 2;

				if (fits(mid)) {
					lo = mid;
				} else {
					hi = mid;
				}
			}
		}

		font = lo;
	}

	const lines = wrapWords(font, innerW);
	const visibleLines = Math.min(
		lines.length,
		Math.floor((innerH + 0.01) / (font * LINE_HEIGHT))
	);

	return {
		box: {x: left, y: top, width, height},
		font,
		lines,
		pad,
		visibleLines
	};
}

/** Bezel and stand sizes, in figure units. */
const PHONE_BEZEL = {x: 6, y: 3};
const MONITOR_BEZEL = 3;
const STAND = {neck: 8, base: 3, baseWidth: 40};
const GAP = 14;
const LABEL_SPACE = 12;

const PHONE_BODY = {
	width: PHONE_STAGE.width + PHONE_BEZEL.x * 2,
	height: PHONE_STAGE.height + PHONE_BEZEL.y * 2
};
const MONITOR_BODY = {
	width: DESKTOP_STAGE.width + MONITOR_BEZEL * 2,
	height: DESKTOP_STAGE.height + MONITOR_BEZEL * 2
};
const FIGURE_W = PHONE_BODY.width + GAP + MONITOR_BODY.width;
const DEVICE_H = MONITOR_BODY.height + STAND.neck + STAND.base;
const FIGURE_H = DEVICE_H + LABEL_SPACE;

let nextClip = 0;

/**
 * One stage with the speaker and the bubble on it.
 *
 * The speaker is drawn as stage fractions, so it scales with the screen like the art does
 * — which is what makes a fixed-px bubble visibly bigger on the phone.
 */
const SizingStageDrawing: React.FC<{
	sizing: BubbleSizing;
	stage: SizingStage;
	x: number;
	y: number;
}> = ({sizing, stage, x, y}) => {
	const clipRef = React.useRef<string>();

	if (clipRef.current === undefined) {
		clipRef.current = `bubble-sizing-clip-${nextClip++}`;
	}

	const clip = clipRef.current;
	const layout = layoutSizing(sizing, stage);
	const {box, font, pad} = layout;
	const pitch = font * LINE_HEIGHT;
	const bar = font * 0.62;
	const clipped = layout.visibleLines < layout.lines.length;
	const head = {
		cx: stage.width * 0.74,
		cy: stage.height * 0.56,
		r: stage.height * 0.09
	};
	const tailX = box.x + box.width * 0.7;
	const tailY = box.y + box.height;

	return (
		<g transform={`translate(${x} ${y})`}>
			<rect
				className="bubble-sizing-stage"
				height={stage.height}
				width={stage.width}
			/>
			<line
				className="bubble-sizing-ground"
				x1={0}
				x2={stage.width}
				y1={stage.height * 0.86}
				y2={stage.height * 0.86}
			/>
			<circle className="bubble-sizing-speaker" {...head} />
			<path
				className="bubble-sizing-speaker"
				d={`M ${head.cx - head.r * 1.6} ${stage.height * 0.86} Q ${head.cx} ${
					head.cy - head.r * 0.2
				} ${head.cx + head.r * 1.6} ${stage.height * 0.86} Z`}
			/>
			<defs>
				<clipPath id={clip}>
					<rect
						height={box.height - pad.y * 2}
						width={box.width}
						x={box.x}
						y={box.y + pad.y}
					/>
				</clipPath>
			</defs>
			<path
				className="bubble-sizing-bubble"
				d={`M ${tailX - box.height * 0.18} ${tailY - 0.2} L ${
					head.cx - head.r
				} ${head.cy - head.r} L ${tailX + box.height * 0.12} ${tailY - 0.2} Z`}
			/>
			<rect
				className="bubble-sizing-bubble"
				height={box.height}
				rx={Math.min(box.height, box.width) * 0.18}
				width={box.width}
				x={box.x}
				y={box.y}
			/>
			{clipped &&
				// The words the box hides, ghosted below it, so "clipped" is something you see.
				layout.lines
					.slice(layout.visibleLines)
					.map((line, i) =>
						line.words.map(([wx, ww], j) => (
							<rect
								className="bubble-sizing-ghost"
								height={bar}
								key={`g${i}-${j}`}
								rx={bar / 2}
								width={ww}
								x={box.x + pad.x + wx}
								y={
									box.y +
									pad.y +
									(layout.visibleLines + i) * pitch +
									(pitch - bar) / 2
								}
							/>
						))
					)}
			<g clipPath={`url(#${clip})`}>
				{layout.lines.map((line, i) =>
					line.words.map(([wx, ww], j) => (
						<rect
							className="bubble-sizing-word"
							height={bar}
							key={`${i}-${j}`}
							rx={bar / 2}
							width={ww}
							x={box.x + pad.x + wx}
							y={box.y + pad.y + i * pitch + (pitch - bar) / 2}
						/>
					))
				)}
			</g>
			{clipped && (
				<line
					className="bubble-sizing-cut"
					x1={box.x + 0.6}
					x2={box.x + box.width - 0.6}
					y1={box.y + box.height}
					y2={box.y + box.height}
				/>
			)}
		</g>
	);
};

/** The phone-and-desktop figure for one sizing. */
export const BubbleSizingFigure: React.FC<{sizing: BubbleSizing}> = ({
	sizing
}) => {
	const {t} = useTranslation();
	const phoneY = MONITOR_BODY.height / 2 - PHONE_BODY.height / 2;
	const monitorX = PHONE_BODY.width + GAP;

	return (
		<svg
			aria-hidden
			className="bubble-sizing-figure"
			data-sizing={sizing}
			viewBox={`0 0 ${FIGURE_W} ${FIGURE_H}`}
		>
			<rect
				className="bubble-sizing-device"
				height={PHONE_BODY.height}
				rx={6}
				width={PHONE_BODY.width}
				x={0}
				y={phoneY}
			/>
			<rect
				className="bubble-sizing-notch"
				height={PHONE_STAGE.height * 0.36}
				rx={0.9}
				width={1.8}
				x={2.1}
				y={phoneY + PHONE_BODY.height / 2 - PHONE_STAGE.height * 0.18}
			/>
			<SizingStageDrawing
				sizing={sizing}
				stage={PHONE_STAGE}
				x={PHONE_BEZEL.x}
				y={phoneY + PHONE_BEZEL.y}
			/>
			<rect
				className="bubble-sizing-device"
				height={STAND.neck + 1}
				width={10}
				x={monitorX + MONITOR_BODY.width / 2 - 5}
				y={MONITOR_BODY.height - 0.5}
			/>
			<rect
				className="bubble-sizing-device"
				height={STAND.base}
				rx={1.5}
				width={STAND.baseWidth}
				x={monitorX + MONITOR_BODY.width / 2 - STAND.baseWidth / 2}
				y={MONITOR_BODY.height + STAND.neck}
			/>
			<rect
				className="bubble-sizing-device"
				height={MONITOR_BODY.height}
				rx={3}
				width={MONITOR_BODY.width}
				x={monitorX}
				y={0}
			/>
			<SizingStageDrawing
				sizing={sizing}
				stage={DESKTOP_STAGE}
				x={monitorX + MONITOR_BEZEL}
				y={MONITOR_BEZEL}
			/>
			<text
				className="bubble-sizing-caption"
				textAnchor="middle"
				x={PHONE_BODY.width / 2}
				y={FIGURE_H - 2}
			>
				{t('components.bubbleSizing.phone')}
			</text>
			<text
				className="bubble-sizing-caption"
				textAnchor="middle"
				x={monitorX + MONITOR_BODY.width / 2}
				y={FIGURE_H - 2}
			>
				{t('components.bubbleSizing.desktop')}
			</text>
		</svg>
	);
};

/** Figure plus what it shows, for the dropdown's explanation pane. */
export const BubbleSizingExplanation: React.FC<{
	sizing: BubbleSizing;
	/** Said above the prose — on the empty option, what it resolves to and why. */
	note?: string;
}> = ({note, sizing}) => {
	const {t} = useTranslation();

	return (
		<div className="bubble-sizing-explanation">
			<BubbleSizingFigure sizing={sizing} />
			{note && <p className="bubble-sizing-note">{note}</p>}
			<p className="bubble-sizing-title">
				{t(`components.bubbleSizing.${sizing}Title`)}
			</p>
			<p className="bubble-sizing-text">
				{t(`components.bubbleSizing.${sizing}Text`)}
			</p>
		</div>
	);
};

/**
 * The `sizing:` list for a `PreviewSelect`: an empty option that writes nothing, then
 * the three sizings, each explained.
 *
 * `inherited` is what the empty option resolves to — the scene or story value on a beat,
 * the built-in `auto` in the Defaults dialog. A caller that cannot know it (the scene
 * panel does not read the story's defaults) says so in `emptyNote`.
 */
export function bubbleSizingOptions(options: {
	emptyLabel: string;
	emptyValue: string;
	emptyNote?: string;
	inherited?: BubbleSizing;
	t: (key: string, values?: Record<string, string>) => string;
}): PreviewSelectOption[] {
	const {emptyLabel, emptyValue, t} = options;
	const inherited = options.inherited ?? 'auto';
	const emptyNote =
		options.emptyNote ??
		t('components.bubbleSizing.inherited', {value: inherited});

	return [
		{
			detail: inherited,
			explanation: (
				<BubbleSizingExplanation note={emptyNote} sizing={inherited} />
			),
			label: emptyLabel,
			value: emptyValue
		},
		...BUBBLE_SIZINGS.map(sizing => ({
			detail: t(`components.bubbleSizing.${sizing}Detail`),
			explanation: <BubbleSizingExplanation sizing={sizing} />,
			label: sizing,
			value: sizing
		}))
	];
}
