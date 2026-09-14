import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import './editable-title.css';

export interface EditableTitleProps {
	/**
	 * What the title looks like when it isn't being edited. Defaults to `value`; the
	 * passage editor's header passes tag chips and a whitespace-visible name instead.
	 */
	children?: React.ReactNode;
	/**
	 * May the title be edited right now? A title that can't is rendered as plain text
	 * and clicks fall through to whatever is underneath--which is what lets a passage
	 * card be selected by clicking its name.
	 */
	editable?: boolean;
	/** Is another thing already called this? Checked as the author types. */
	nameTaken?: (name: string) => boolean;
	onRename: (name: string) => void;
	/** Tooltip shown on a title that can be clicked to rename. */
	title?: string;
	value: string;
	/**
	 * Hold the rename back until it's clear no second click is coming. Needed wherever a
	 * double click already means something--on the story map it opens the passage
	 * editor, and without this the first click of that pair would open a rename field
	 * for the second one to land in.
	 */
	waitForDoubleClick?: boolean;
}

/** How long a second click may take to arrive. Matches the usual OS double-click time. */
const doubleClickDelay = 350;

/**
 * A title that renames itself when clicked. Used by the passage card on the story map
 * and by the passage editor's own title bar.
 *
 * Deliberately not the `PromptButton` the toolbars use: that opens a popper, and the
 * story map lives inside a `transform: scale()`, which makes it the containing block
 * for the popper's fixed positioning and puts the card in the wrong place at any zoom
 * but 100%.
 */
export const EditableTitle: React.FC<EditableTitleProps> = props => {
	const {
		children,
		editable,
		nameTaken,
		onRename,
		title,
		value,
		waitForDoubleClick
	} = props;
	const [editing, setEditing] = React.useState(false);
	const [draft, setDraft] = React.useState(value);
	// Set by Escape and by a submit, both of which have already decided what happens to
	// the draft--without it, the blur that follows either one would decide again.
	const handled = React.useRef(false);
	const {t} = useTranslation();
	const draftValid =
		draft.trim() !== '' && (draft === value || !nameTaken?.(draft));

	// Something else renamed this--find and replace, a sync pull, the toolbar's own
	// button. The draft is stale, so stop editing rather than let it overwrite.
	React.useEffect(() => setEditing(false), [value]);

	const startTimeout = React.useRef<number>();

	React.useEffect(
		() => () => window.clearTimeout(startTimeout.current),
		[]
	);

	const start = React.useCallback(() => {
		handled.current = false;
		setDraft(value);
		setEditing(true);
	}, [value]);

	const handleClick = React.useCallback(
		(event: React.MouseEvent) => {
			// A modified click is a selection gesture wherever this is used, so it goes
			// to whatever is underneath.

			if (!editable || editing || event.ctrlKey || event.shiftKey) {
				return;
			}

			if (!waitForDoubleClick) {
				event.stopPropagation();
				start();
				return;
			}

			// The click still reaches whatever is underneath--the card this sits on has
			// to be able to stay selected--so only the rename itself waits.

			if (event.detail > 1) {
				return;
			}

			window.clearTimeout(startTimeout.current);
			startTimeout.current = window.setTimeout(start, doubleClickDelay);
		},
		[editable, editing, start, waitForDoubleClick]
	);

	const handleDoubleClick = React.useCallback(
		() => window.clearTimeout(startTimeout.current),
		[]
	);

	const handleKeyDown = React.useCallback((event: React.KeyboardEvent) => {
		// A passage card is a `role="button"` that treats space and enter as selection,
		// and hotkey scopes sit above both places this is used, so none of this may
		// bubble.

		event.stopPropagation();

		if (event.key === 'Escape') {
			handled.current = true;
			setEditing(false);
		}
	}, []);

	const commit = React.useCallback(() => {
		setEditing(false);

		if (draft !== value) {
			onRename(draft);
		}
	}, [draft, onRename, value]);

	const handleSubmit = React.useCallback(
		(event: React.FormEvent) => {
			event.preventDefault();

			if (!draftValid) {
				return;
			}

			handled.current = true;
			commit();
		},
		[commit, draftValid]
	);

	// Clicking away keeps the name if it can be had, and abandons it otherwise--a name
	// that's already taken has no way out except giving up on it.
	const handleBlur = React.useCallback(() => {
		setEditing(false);

		if (handled.current) {
			return;
		}

		if (draftValid) {
			commit();
		}
	}, [commit, draftValid]);

	if (editing) {
		return (
			<form
				className="editable-title-form"
				onClick={event => event.stopPropagation()}
				onDoubleClick={event => event.stopPropagation()}
				onMouseDown={event => event.stopPropagation()}
				onSubmit={handleSubmit}
			>
				<input
					aria-invalid={!draftValid}
					aria-label={t('common.rename')}
					autoFocus
					data-testid="editable-title-input"
					onBlur={handleBlur}
					onChange={event => setDraft(event.target.value)}
					onKeyDown={handleKeyDown}
					size={1}
					value={draft}
				/>
			</form>
		);
	}

	return (
		<span
			className={classNames('editable-title', {editable})}
			onClick={handleClick}
			onDoubleClick={handleDoubleClick}
			title={editable ? title ?? t('components.editableTitle.hint') : undefined}
		>
			{children ?? value}
		</span>
	);
};
