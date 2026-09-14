import classNames from 'classnames';
import {deviceType} from 'detect-it';
import * as React from 'react';
import {DraggableCore, DraggableCoreProps} from 'react-draggable';
import {useTranslation} from 'react-i18next';
import {CardContent} from '../container/card';
import {SelectableCard} from '../container/card/selectable-card';
import {Passage, TagColors} from '../../store/stories';
import {TagStripe} from '../tag/tag-stripe';
import {passageIsEmpty} from '../../util/passage-is-empty';
import './passage-card.css';
import {TagBadges} from '../tag/tag-badges';

export interface PassageCardProps {
	/** How many scene errors this passage has, if any. */
	errorCount?: number;
	/**
	 * This card stands for a link target the story has no passage for yet--see
	 * `brokenLinkGhosts`. A flag rather than something read off the passage, because the
	 * synthetic behind it is a `Passage` in every other respect: nothing about it says
	 * "do not touch the store", and this card must.
	 */
	ghost?: boolean;
	/** Another editor has this passage open. Their name, for a one-letter badge. */
	lockedBy?: string;
	/** Makes a ghost real. Never called on an ordinary card. */
	onCreate?: (passage: Passage) => void;
	onEdit: (passage: Passage) => void;
	onDeselect: (passage: Passage) => void;
	onDragStart?: DraggableCoreProps['onStart'];
	onDrag?: DraggableCoreProps['onDrag'];
	onDragStop?: DraggableCoreProps['onStop'];
	onSelect: (passage: Passage, exclusive: boolean) => void;
	passage: Passage;
	tagColors: TagColors;
	tagDisplay: 'color' | 'name';
}

// Needs to fill a large-sized passage card.
const excerptLength = 400;

export const PassageCard: React.FC<PassageCardProps> = React.memo(props => {
	const {
		errorCount,
		ghost,
		lockedBy,
		onCreate,
		onDeselect,
		onDrag,
		onDragStart,
		onDragStop,
		onEdit,
		onSelect,
		passage,
		tagColors,
		tagDisplay
	} = props;
	const {t} = useTranslation();
	const className = React.useMemo(
		() =>
			classNames('passage-card', {
				empty: passageIsEmpty(passage),
				ghost,
				'has-errors': !!errorCount,
				'is-locked': !!lockedBy,
				selected: passage.selected,
				[`tag-display-${tagDisplay}`]: true
			}),
		[errorCount, ghost, lockedBy, passage, tagDisplay]
	);
	const container = React.useRef<HTMLDivElement>(null);
	const excerpt = React.useMemo(() => {
		if (ghost) {
			return (
				<span className="placeholder">
					{t('components.passageCard.placeholderGhost')}
				</span>
			);
		}

		if (passage.text.length > 0) {
			return passage.text.substring(0, excerptLength);
		}

		return (
			<span className="placeholder">
				{t(
					deviceType === 'touchOnly'
						? 'components.passageCard.placeholderTouch'
						: 'components.passageCard.placeholderClick'
				)}
			</span>
		);
	}, [ghost, passage.text, t]);
	const style = React.useMemo(
		() => ({
			height: passage.height,
			left: passage.left,
			top: passage.top,
			width: passage.width
		}),
		[passage.height, passage.left, passage.top, passage.width]
	);
	const handleMouseDown = React.useCallback(
		(event: MouseEvent) => {
			// Shift- or control-clicking toggles our selected status, but doesn't
			// affect any other passage's selected status. If the shift or control key
			// was not held down and we were not already selected, we know the user
			// wants to select only this passage.

			if (event.shiftKey || event.ctrlKey) {
				if (passage.selected) {
					onDeselect(passage);
				} else {
					onSelect(passage, false);
				}
			} else if (!passage.selected) {
				onSelect(passage, true);
			}
		},
		[onDeselect, onSelect, passage]
	);
	const handleEdit = React.useCallback(
		() => onEdit(passage),
		[onEdit, passage]
	);
	const handleSelect = React.useCallback(
		(value: boolean, exclusive: boolean) => {
			onSelect(passage, exclusive);
		},
		[onSelect, passage]
	);
	const handleCreate = React.useCallback(
		() => onCreate?.(passage),
		[onCreate, passage]
	);

	const card = (
		<div
			className={className}
			ref={container}
			style={style}
			data-passage-tags={passage.tags.join(' ')}
			data-testid={ghost ? `ghost-passage-${passage.name}` : undefined}
		>
			<SelectableCard
				highlighted={passage.highlighted}
				label={passage.name}
				// A ghost has one gesture, and both of these are it: there is nothing to
				// edit until the passage exists.
				onDoubleClick={ghost ? handleCreate : handleEdit}
				onSelect={ghost ? handleCreate : handleSelect}
				selected={passage.selected}
			>
				{tagDisplay === 'color' && (
					<TagStripe tagColors={tagColors} tags={passage.tags} />
				)}
				{!!errorCount && (
					<span
						className="passage-card-error-badge"
						data-testid="passage-card-error-badge"
						role="img"
						title={t('components.passageCard.errors', {count: errorCount})}
					>
						{'\u26a0\ufe0f'}
					</span>
				)}
				{lockedBy && (
					<span
						className="passage-card-lock"
						data-locked-by={lockedBy}
						data-testid="passage-card-lock"
						title={t('routes.storyEdit.presence.editingPassage', {
							name: lockedBy
						})}
					>
						{(lockedBy.trim()[0] ?? '?').toUpperCase()}
					</span>
				)}
				<h2>{passage.name}</h2>
				<CardContent>{excerpt}</CardContent>
				{tagDisplay === 'name' && (
					<TagBadges tagColors={tagColors} tags={passage.tags} />
				)}
			</SelectableCard>
		</div>
	);

	// Same card, with the half that touches the store left unwired. A ghost has no
	// passage behind it: `onSelect`/`onDeselect` reach `selectPassage`, which throws on a
	// passage its story does not have, and a drag would commit a move of nothing--it can
	// never be `.selected`, so it would not even appear to move.

	if (ghost) {
		return card;
	}

	return (
		<DraggableCore
			nodeRef={container}
			onMouseDown={handleMouseDown}
			onStart={onDragStart}
			onDrag={onDrag}
			onStop={onDragStop}
		>
			{card}
		</DraggableCore>
	);
});

PassageCard.displayName = 'PassageCard';
