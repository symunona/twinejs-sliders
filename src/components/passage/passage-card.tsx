import classNames from 'classnames';
import {deviceType} from 'detect-it';
import * as React from 'react';
import {DraggableCore, DraggableCoreProps} from 'react-draggable';
import {useTranslation} from 'react-i18next';
import {CardContent} from '../container/card';
import {EditableTitle} from '../control/editable-title';
import {SelectableCard} from '../container/card/selectable-card';
import {Passage, TagColors} from '../../store/stories';
import {TagStripe} from '../tag/tag-stripe';
import {passageIsEmpty} from '../../util/passage-is-empty';
import {passageProse} from '../../util/passage-prose';
import {passagePreviewsScene} from '../../util/passage-sizes';
import {PassageCardScene} from './passage-card-scene';
import {IndexedPassage} from '@sliders/scene-index';
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
	/**
	 * Is another passage already called this? Renaming in place needs to know before the
	 * name is committed, and only the story can answer.
	 */
	nameTaken?: (name: string) => boolean;
	/** Makes a ghost real. Never called on an ordinary card. */
	onCreate?: (passage: Passage) => void;
	onEdit: (passage: Passage) => void;
	onDeselect: (passage: Passage) => void;
	onDragStart?: DraggableCoreProps['onStart'];
	onDrag?: DraggableCoreProps['onDrag'];
	onDragStop?: DraggableCoreProps['onStop'];
	/** Omitted to make the title inert, e.g. in a read-only map. */
	onRename?: (passage: Passage, name: string) => void;
	onSelect: (passage: Passage, exclusive: boolean) => void;
	passage: Passage;
	/**
	 * Every passage in the story, for the scene strip a `largeWithPreview` card draws--a
	 * patch scene (`from:`) inherits from another passage, so one passage's text is not
	 * enough to stage it. Passed only to the cards that draw one, so an ordinary card's
	 * memo is not broken by an array that changes on every edit.
	 */
	scenePassages?: IndexedPassage[];
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
		nameTaken,
		onCreate,
		onDeselect,
		onDrag,
		onDragStart,
		onDragStop,
		onEdit,
		onRename,
		onSelect,
		passage,
		scenePassages,
		tagColors,
		tagDisplay
	} = props;
	const {t} = useTranslation();
	const showsScene = !ghost && passagePreviewsScene(passage);
	const className = React.useMemo(
		() =>
			classNames('passage-card', {
				empty: passageIsEmpty(passage),
				ghost,
				'has-errors': !!errorCount,
				'is-locked': !!lockedBy,
				'has-scene-preview': showsScene,
				selected: passage.selected,
				[`tag-display-${tagDisplay}`]: true
			}),
		[errorCount, ghost, lockedBy, passage, showsScene, tagDisplay]
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

		// What the passage SAYS, never the machinery: the vars section that sets it up and
		// the `[scene]` block that stages it are both cut. One is front matter the author
		// wrote deliberately and knows is there; the other is already on screen as a
		// picture on a card that draws one.
		const text = passageProse(passage.text);

		if (text.length > 0) {
			return text.substring(0, excerptLength);
		}

		if (showsScene) {
			// Nothing but a scene in this passage. The stage below is the excerpt.
			return null;
		}

		if (passage.text.trim().length > 0) {
			// All machinery and no prose, and no stage to show it off either. The raw text
			// is a poor excerpt, but the card is not empty and must not claim to be.
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
	}, [ghost, passage.text, showsScene, t]);
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

	// Renaming from the title, the way a file manager does it: one click selects the
	// card, a click on the title of an already-selected card starts the rename.

	const handleRename = React.useCallback(
		(name: string) => onRename?.(passage, name),
		[onRename, passage]
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
				<h2>
					<EditableTitle
						editable={!ghost && !!onRename && !!passage.selected}
						nameTaken={nameTaken}
						onRename={handleRename}
						title={t('components.passageCard.renameTitle')}
						value={passage.name}
						waitForDoubleClick
					/>
				</h2>
				<CardContent>{excerpt}</CardContent>
				{showsScene && (
					<PassageCardScene
						passages={scenePassages ?? []}
						text={passage.text}
					/>
				)}
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
			// Dragging the title field would move the card instead of putting the cursor
			// where it was clicked.
			cancel=".editable-title-form"
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
