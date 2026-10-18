/**
 * Picking a bubble's fill or its stroke.
 *
 * NOT a `PreviewSelect`. A colour is not a choice from a list — there are sixteen million
 * of them — so the swatch here opens the platform's own colour picker rather than a menu,
 * and the dropdown component is reserved for the two choices that really are lists.
 *
 * Three parts, and each earns its place:
 *
 *   - The WELL is a native `<input type="color">` sitting invisibly on top of the swatch.
 *     Native because the OS picker is better than anything worth building here, and because
 *     it is the one control every author already knows how to use.
 *   - The ALPHA slider is the opacity channel the well does not have. It and the well each
 *     keep the other's half: a new hue keeps the alpha, a new alpha keeps the hue. Opaque
 *     writes `#rrggbb`, anything less `rgba(r, g, b, a)` — the spelling an author would type.
 *     Disabled for a value it cannot split (`var(--…)`, a colour name), rather than
 *     overwriting that with a guess.
 *   - The CLEAR button removes the key. It has to be separate: a colour input has no "no
 *     colour" state, so without it an author who set a bubble red could never get back to
 *     "whatever the layer above says", which is the state every one of these starts in.
 *   - The TEXT field, only where there is room for it, takes the values the well cannot
 *     express — `rgba(0, 0, 0, 0.6)`, `transparent`, a `var(--…)` from the story's own
 *     stylesheet. `bg:` has always accepted any CSS colour and the well would quietly
 *     narrow that to opaque hex.
 *
 *   - The QUICK LIST, only when the caller hands one over, is every colour the story
 *     already uses (`util/story-colors.ts`). Matching a colour set three scenes ago is the
 *     common case, and the OS picker has no memory of it. A pick writes the string exactly
 *     as the story spells it, `rgba(…)` included, which the well could not.
 *
 * A value the well cannot show is still SHOWN, in the swatch, which is plain CSS and can
 * paint anything: the well falls back to black underneath it, but the author sees their
 * actual colour and the text field holds their actual string.
 */

import {IconChevronDown} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {CardButton} from '../../components/control/card-button';
import './bubble-color-control.css';

export interface BubbleColorControlProps {
	/** The control's own name. */
	children: React.ReactNode;
	/** Removes the key when the author clears it. */
	onChange: (value: string | undefined) => void;
	/** Label for the clear button, which is an icon otherwise. */
	clearLabel: string;
	disabled?: boolean;
	/** Adds the free-text field. On in the Defaults dialog, off in the beat row. */
	editable?: boolean;
	placeholder?: string;
	/** Colours the story already uses. Empty or absent hides the quick list. */
	swatches?: string[];
	/** Label for the quick list's button and card. Required with `swatches`. */
	swatchesLabel?: string;
	/** The colour as the file states it, or nothing when no layer has set one. */
	value?: string;
}

/** What the native well shows for a colour it cannot parse. */
const WELL_FALLBACK = '#000000';

/** A colour split into what the well shows and what the alpha slider shows. */
export interface ColorChannels {
	/** `#rrggbb`, lower case. */
	hex: string;
	/** 0..1. */
	alpha: number;
}

function hexByte(value: number): string {
	return Math.round(Math.min(255, Math.max(0, value)))
		.toString(16)
		.padStart(2, '0');
}

/**
 * The hex and alpha in a colour, or undefined for one this cannot split: `#rgb`, `#rgba`,
 * `#rrggbb`, `#rrggbbaa`, numeric `rgb()`/`rgba()` and `transparent`. Names and `var(--…)`
 * are left alone — the well and the slider would only be guessing.
 */
export function colorChannels(
	value: string | undefined
): ColorChannels | undefined {
	const trimmed = value?.trim().toLowerCase();

	if (!trimmed) {
		return undefined;
	}

	if (trimmed === 'transparent') {
		return {alpha: 0, hex: WELL_FALLBACK};
	}

	const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(trimmed)?.[1];

	if (hex) {
		const long =
			hex.length <= 4
				? hex
						.split('')
						.map(digit => digit + digit)
						.join('')
				: hex;

		return {
			alpha:
				long.length === 8
					? Math.round((parseInt(long.slice(6), 16) / 255) * 100) / 100
					: 1,
			hex: `#${long.slice(0, 6)}`
		};
	}

	const rgb =
		/^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/.exec(
			trimmed
		);

	if (rgb) {
		const alpha =
			rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] === '%' ? 100 : 1);

		return {
			alpha: Math.min(1, Math.max(0, alpha)),
			hex: `#${hexByte(Number(rgb[1]))}${hexByte(Number(rgb[2]))}${hexByte(
				Number(rgb[3])
			)}`
		};
	}

	return undefined;
}

/** The spelling written back: `#rrggbb` when opaque, `rgba(…)` otherwise. */
export function formatColor({alpha, hex}: ColorChannels): string {
	const a = Math.round(Math.min(1, Math.max(0, alpha)) * 100) / 100;

	if (a === 1) {
		return hex;
	}

	const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));

	return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export const BubbleColorControl: React.FC<BubbleColorControlProps> = ({
	children,
	clearLabel,
	disabled,
	editable,
	onChange,
	placeholder,
	swatches,
	swatchesLabel,
	value
}) => {
	const {t} = useTranslation();
	const alphaLabel = t('common.opacity');
	const [swatchesOpen, setSwatchesOpen] = React.useState(false);
	const channels = colorChannels(value);
	/**
	 * The alpha while its slider is being dragged. Painted into the swatch on every move,
	 * written once on release — a drag is one edit, as the text field's typing is.
	 */
	const [alphaDraft, setAlphaDraft] = React.useState<number>();
	const alpha = alphaDraft ?? channels?.alpha ?? 1;
	const [alphaEl, setAlphaEl] = React.useState<HTMLInputElement | null>(null);
	const commitAlphaRef = React.useRef<() => void>(() => undefined);

	commitAlphaRef.current = () => {
		if (alphaDraft === undefined) {
			return;
		}

		setAlphaDraft(undefined);
		onChange(
			formatColor({alpha: alphaDraft, hex: channels?.hex ?? WELL_FALLBACK})
		);
	};

	// A range fires `input` through a drag and `change` once, on release (or per arrow key).
	// React's `onChange` is `input`, so the release is listened for natively.
	React.useEffect(() => {
		if (!alphaEl) {
			return;
		}

		const commit = () => commitAlphaRef.current();

		alphaEl.addEventListener('change', commit);

		return () => alphaEl.removeEventListener('change', commit);
	}, [alphaEl]);

	/**
	 * What is in the text field while it is being typed in.
	 *
	 * Committed on blur and on Enter rather than per keystroke, for the reason the font
	 * field in `story-defaults.tsx` gives too: every write is a passage edit or a
	 * CodeMirror edit, and one per character would fill the undo stack with `#`, `#f`,
	 * `#ff` and reparse the scene between each.
	 */
	const [draft, setDraft] = React.useState<string>();

	// Whatever was being typed is stale once the value underneath changes.
	React.useEffect(() => setDraft(undefined), [value]);

	function commit() {
		if (draft === undefined) {
			return;
		}

		const trimmed = draft.trim();

		setDraft(undefined);
		onChange(trimmed === '' ? undefined : trimmed);
	}

	const shown =
		alphaDraft !== undefined && channels
			? formatColor({alpha: alphaDraft, hex: channels.hex})
			: value;

	return (
		<span className="bubble-color-control">
			<span className="bubble-color-control-label">{children}</span>
			<span className="bubble-color-control-well">
				<span
					aria-hidden
					className="bubble-color-preview"
					style={{['--swatch' as string]: shown || 'transparent'}}
				/>
				<input
					aria-label={String(children)}
					disabled={disabled}
					onChange={event =>
						onChange(formatColor({alpha, hex: event.target.value}))
					}
					type="color"
					value={channels?.hex ?? WELL_FALLBACK}
				/>
			</span>
			<input
				aria-label={`${String(children)} ${alphaLabel}`}
				className="bubble-color-control-alpha"
				disabled={disabled || (!!value && !channels)}
				max={1}
				min={0}
				onChange={event => setAlphaDraft(Number(event.target.value))}
				ref={setAlphaEl}
				step={0.05}
				title={`${alphaLabel} ${Math.round(alpha * 100)}%`}
				type="range"
				value={alpha}
			/>
			{swatches && swatches.length > 0 && (
				<CardButton
					ariaLabel={swatchesLabel ?? ''}
					disabled={disabled}
					icon={<IconChevronDown />}
					iconOnly
					label={swatchesLabel ?? ''}
					onChangeOpen={setSwatchesOpen}
					open={swatchesOpen}
				>
					<span className="bubble-color-swatches">
						{swatches.map(swatch => (
							<button
								aria-pressed={swatch === value}
								className="bubble-color-swatch"
								key={swatch}
								onClick={() => {
									setSwatchesOpen(false);
									onChange(swatch);
								}}
								title={swatch}
								type="button"
							>
								<span
									aria-hidden
									className="bubble-color-preview"
									style={{['--swatch' as string]: swatch}}
								/>
								<span className="bubble-color-control-clear-label">
									{swatch}
								</span>
							</button>
						))}
					</span>
				</CardButton>
			)}
			{editable && (
				<input
					aria-label={`${String(children)} value`}
					className="bubble-color-control-text"
					disabled={disabled}
					onBlur={commit}
					onChange={event => setDraft(event.target.value)}
					onKeyDown={event => {
						if (event.key === 'Enter') {
							(event.target as HTMLInputElement).blur();
						}

						if (event.key === 'Escape') {
							setDraft(undefined);
						}
					}}
					placeholder={placeholder}
					type="text"
					value={draft ?? value ?? ''}
				/>
			)}
			<button
				className="bubble-color-control-clear"
				disabled={disabled || !value}
				onClick={() => onChange(undefined)}
				title={clearLabel}
				type="button"
			>
				<span aria-hidden>&times;</span>
				<span className="bubble-color-control-clear-label">{clearLabel}</span>
			</button>
		</span>
	);
};
