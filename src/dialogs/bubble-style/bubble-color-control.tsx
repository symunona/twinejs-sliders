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
 *   - The CLEAR button removes the key. It has to be separate: a colour input has no "no
 *     colour" state, so without it an author who set a bubble red could never get back to
 *     "whatever the layer above says", which is the state every one of these starts in.
 *   - The TEXT field, only where there is room for it, takes the values the well cannot
 *     express — `rgba(0, 0, 0, 0.6)`, `transparent`, a `var(--…)` from the story's own
 *     stylesheet. `bg:` has always accepted any CSS colour and the well would quietly
 *     narrow that to opaque hex.
 *
 * A value the well cannot show is still SHOWN, in the swatch, which is plain CSS and can
 * paint anything: the well falls back to black underneath it, but the author sees their
 * actual colour and the text field holds their actual string.
 */

import * as React from 'react';
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
	/** The colour as the file states it, or nothing when no layer has set one. */
	value?: string;
}

/** What the native well shows for a colour it cannot parse. */
const WELL_FALLBACK = '#000000';

/** `#rgb` and `#rrggbb` are the only things `<input type="color">` will take. */
function wellValue(value: string | undefined): string {
	if (!value) {
		return WELL_FALLBACK;
	}

	const trimmed = value.trim();

	if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
		return trimmed.toLowerCase();
	}

	// Expand `#abc`, which the well rejects outright rather than expanding itself.
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(trimmed);

	return short
		? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase()
		: WELL_FALLBACK;
}

export const BubbleColorControl: React.FC<BubbleColorControlProps> = ({
	children,
	clearLabel,
	disabled,
	editable,
	onChange,
	placeholder,
	value
}) => {
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

	return (
		<span className="bubble-color-control">
			<span className="bubble-color-control-label">{children}</span>
			<span className="bubble-color-control-well">
				<span
					aria-hidden
					className="bubble-color-preview"
					style={{['--swatch' as string]: value || 'transparent'}}
				/>
				<input
					aria-label={String(children)}
					disabled={disabled}
					onChange={event => onChange(event.target.value)}
					type="color"
					value={wellValue(value)}
				/>
			</span>
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
