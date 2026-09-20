/**
 * A dropdown whose options are SHOWN, not just named.
 *
 * `TextSelect` wraps a native `<select>`, and a native `<option>` can hold exactly one
 * string. That is fine for `place: top` — the word is the whole meaning — and useless for
 * the two choices this control exists for: which speech bubble a line is drawn in, and
 * which comic face it is lettered in. Both are pictures. An author picking "shard" from a
 * list of seven lowercase words is guessing, opening the dropdown, guessing again.
 *
 * So each option carries a `preview` node and the list renders it. The rest of the control
 * is what a native select gave away by being replaced, put back by hand:
 *
 *   - Keyboard. Up/down move a highlight, Enter and Space commit it, Escape closes without
 *     committing, Home/End jump. Typing filters when `searchable` is set.
 *   - Focus. The button takes it back when the list closes, so tabbing out of a closed
 *     dropdown lands where the eye is.
 *   - Screen readers. `role="listbox"` over `role="option"` with `aria-selected`, and the
 *     button is `aria-haspopup="listbox"` with `aria-expanded`.
 *
 * PORTALLED TO THE BODY, like `MenuButton` and for the same reason it documents at length:
 * this control's callers live inside `.dialog-transform-setter`, whose `transform` opens a
 * stacking context, so a list rendered in place paints under the full-screen scene editor
 * whatever z-index it is given. Popper's `strategy: 'fixed'` makes the coordinates viewport
 * coordinates, which survive the move.
 *
 * `.preview-select-list` is in `OWN_PRESS_SELECTOR` (`stage-editor-overlay.tsx`). It has to
 * be: React 16 routes a portal's events up the React tree, so a click in this list reaches
 * the stage's `pointerdown`, which clears the selection the beat row belongs to and
 * unmounts the dropdown before the click lands on an option.
 */

import * as React from 'react';
import {createPortal} from 'react-dom';
import classNames from 'classnames';
import {usePopper} from 'react-popper';
import type {Placement} from '@popperjs/core';
import {useTranslation} from 'react-i18next';
import './preview-select.css';

export interface PreviewSelectOption {
	/** The value written when this option is chosen. */
	value: string;
	/** The name of the option, read by search and by a screen reader. */
	label: string;
	/** Drawn next to the label, in the list and on the closed button. */
	preview?: React.ReactNode;
	/** A second line under the label. Never searched — it is commentary, not a name. */
	detail?: string;
}

export interface PreviewSelectProps {
	/** The control's own name, rendered as its label. */
	children: React.ReactNode;
	disabled?: boolean;
	/** Where the list hangs, if not below the button. */
	placement?: Placement;
	onChange: (value: string) => void;
	options: PreviewSelectOption[];
	/**
	 * Adds a filter box at the top of the list.
	 *
	 * Off by default: a filter over seven bubble shapes is a box to tab past. On for the
	 * font list, which is long enough that scanning it beats reading it.
	 */
	searchable?: boolean;
	value: string;
}

/**
 * A DOM id unique to one mounted control, for the aria wiring.
 *
 * Hand-rolled because this is React 16 and `useId` arrived in 18. A module counter is
 * enough here and is what `useId` is not needed for: nothing on this page is server
 * rendered, so there are no two id streams to keep in step.
 */
let nextId = 0;

function useControlId(): string {
	const ref = React.useRef<string>();

	if (ref.current === undefined) {
		ref.current = `preview-select-${nextId++}`;
	}

	return ref.current;
}

/** Strips case and whitespace, so "comic neue" finds "Comic Neue". */
function matches(option: PreviewSelectOption, query: string): boolean {
	const needle = query.trim().toLowerCase();

	if (needle === '') {
		return true;
	}

	return (
		option.label.toLowerCase().includes(needle) ||
		option.value.toLowerCase().includes(needle)
	);
}

export const PreviewSelect: React.FC<PreviewSelectProps> = props => {
	const {
		children,
		disabled,
		onChange,
		options,
		placement = 'bottom-start',
		searchable,
		value
	} = props;
	const {t} = useTranslation();
	const [open, setOpen] = React.useState(false);
	const [query, setQuery] = React.useState('');
	const [active, setActive] = React.useState(0);
	const [buttonEl, setButtonEl] = React.useState<HTMLButtonElement | null>(
		null
	);
	const [listEl, setListEl] = React.useState<HTMLDivElement | null>(null);
	const searchRef = React.useRef<HTMLInputElement>(null);
	const {attributes, styles} = usePopper(buttonEl, listEl, {
		placement,
		strategy: 'fixed'
	});
	const id = useControlId();
	const selected = options.find(option => option.value === value);
	const shown = React.useMemo(
		() => (searchable ? options.filter(o => matches(o, query)) : options),
		[options, query, searchable]
	);

	/**
	 * Opening lands the highlight on what is already chosen, so Enter is a no-op and the
	 * arrows start from where the author is rather than from the top of the list.
	 *
	 * Keyed on `open` ALONE. `options` and `value` are what it reads, but callers build the
	 * option array inline — the ordinary thing to write — so it is a new array on every
	 * parent render, and with it in the dependency list a re-render mid-search wiped the
	 * filter box the author was typing into. The values are read through a ref instead.
	 */
	const latest = React.useRef({options, value});

	latest.current = {options, value};

	React.useEffect(() => {
		if (!open) {
			return;
		}

		const {options: current, value: chosen} = latest.current;

		setQuery('');
		setActive(Math.max(0, current.findIndex(o => o.value === chosen)));
	}, [open]);

	React.useEffect(() => {
		if (open && searchable) {
			searchRef.current?.focus();
		}
	}, [open, searchable]);

	/**
	 * A press anywhere outside closes.
	 *
	 * `pointerdown` in the CAPTURE phase rather than `click`: the stage editor under a beat
	 * row stops propagation of its own presses, and a bubbling `click` listener on the
	 * document never hears them — the list stayed open over a stage the author had already
	 * moved on to.
	 */
	React.useEffect(() => {
		if (!open) {
			return;
		}

		const handle = (event: PointerEvent) => {
			const target = event.target as Node | null;

			if (
				target &&
				(buttonEl?.contains(target) || listEl?.contains(target))
			) {
				return;
			}

			setOpen(false);
		};

		window.addEventListener('pointerdown', handle, true);

		return () => window.removeEventListener('pointerdown', handle, true);
	}, [buttonEl, listEl, open]);

	/**
	 * Keep the highlight in view when the arrows walk it past the fold.
	 *
	 * Feature-detected, not assumed: jsdom has no `scrollIntoView` at all, and this is a
	 * convenience — a list that does not scroll itself is still a working list.
	 */
	React.useEffect(() => {
		if (!open) {
			return;
		}

		const el = listEl?.querySelector(`[data-index='${active}']`);

		if (el && typeof el.scrollIntoView === 'function') {
			el.scrollIntoView({block: 'nearest'});
		}
	}, [active, listEl, open]);

	function commit(next: string) {
		setOpen(false);
		buttonEl?.focus();

		if (next !== value) {
			onChange(next);
		}
	}

	function handleKeyDown(event: React.KeyboardEvent) {
		if (!open) {
			// Down and Enter open the list rather than doing nothing, which is what a native
			// select does and what a hand reaching for the keyboard expects.
			if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
				event.preventDefault();
				setOpen(true);
			}

			return;
		}

		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				setActive(current => Math.min(shown.length - 1, current + 1));
				break;

			case 'ArrowUp':
				event.preventDefault();
				setActive(current => Math.max(0, current - 1));
				break;

			case 'Home':
				event.preventDefault();
				setActive(0);
				break;

			case 'End':
				event.preventDefault();
				setActive(shown.length - 1);
				break;

			case 'Enter':
			case ' ': {
				// Space is a character in the filter box, so it only commits where there is
				// no filter box to type it into.
				if (event.key === ' ' && searchable) {
					return;
				}

				const option = shown[active];

				if (option) {
					event.preventDefault();
					commit(option.value);
				}

				break;
			}

			case 'Escape':
				event.preventDefault();
				// Stopped, not just defaulted: the dialog this control sits in closes on
				// Escape too, so without this one press shut the dropdown AND the dialog
				// behind it. An open dropdown owns the key.
				event.stopPropagation();
				setOpen(false);
				buttonEl?.focus();
				break;
		}
	}

	return (
		<span className={classNames('preview-select', {disabled})}>
			<span className="preview-select-label" id={`${id}-label`}>
				{children}
			</span>
			<button
				aria-expanded={open}
				aria-haspopup="listbox"
				aria-labelledby={`${id}-label ${id}-value`}
				className="preview-select-button"
				disabled={disabled}
				onClick={() => setOpen(current => !current)}
				onKeyDown={handleKeyDown}
				ref={setButtonEl}
				type="button"
			>
				{selected?.preview && (
					<span className="preview-select-preview">{selected.preview}</span>
				)}
				<span className="preview-select-value" id={`${id}-value`}>
					{selected?.label ?? value}
				</span>
				<span className="preview-select-caret" />
			</button>
			{open &&
				createPortal(
					<div
						className="preview-select-list"
						ref={setListEl}
						style={styles.popper}
						{...attributes.popper}
					>
						{searchable && (
							<input
								aria-label={t('components.previewSelect.search')}
								className="preview-select-search"
								onChange={event => {
									setQuery(event.target.value);
									setActive(0);
								}}
								onKeyDown={handleKeyDown}
								placeholder={t('components.previewSelect.search')}
								ref={searchRef}
								type="text"
								value={query}
							/>
						)}
						<div
							aria-labelledby={`${id}-label`}
							className="preview-select-options"
							role="listbox"
						>
							{shown.length === 0 && (
								<p className="preview-select-empty">
									{t('components.previewSelect.noMatches')}
								</p>
							)}
							{shown.map((option, index) => (
								<div
									aria-selected={option.value === value}
									className={classNames('preview-select-option', {
										active: index === active,
										selected: option.value === value
									})}
									data-index={index}
									data-value={option.value}
									key={option.value}
									// Committed on pointerdown, not click: the button loses
									// focus the moment the pointer goes down, and a blur
									// handler upstream can re-render the list out from under
									// the click that would have followed.
									onPointerDown={event => {
										event.preventDefault();
										commit(option.value);
									}}
									onPointerEnter={() => setActive(index)}
									role="option"
								>
									{option.preview && (
										<span className="preview-select-preview">
											{option.preview}
										</span>
									)}
									<span className="preview-select-option-text">
										<span className="preview-select-option-label">
											{option.label}
										</span>
										{option.detail && (
											<span className="preview-select-option-detail">
												{option.detail}
											</span>
										)}
									</span>
								</div>
							))}
						</div>
					</div>,
					document.body
				)}
		</span>
	);
};
