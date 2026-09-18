import * as React from 'react';
import {CSSTransition, TransitionGroup} from 'react-transition-group';
import {IndexedPassage} from '@sliders/scene-index';
import {Passage} from '../../store/stories';
import {passagePreviewsScene} from '../../util/passage-sizes';
import {PassageCard, PassageCardProps} from './passage-card';
import '../../styles/animations.css';

export interface PassageCardGroupProps extends Omit<
	PassageCardProps,
	'errorCount' | 'ghost' | 'lockedBy' | 'passage' | 'scenePassages'
> {
	/** Passage ID -> scene error count, for the cards that have any. */
	errorCounts?: Record<string, number>;
	/**
	 * Which of `passages` are ghosts--link targets with no passage behind them yet. A set
	 * of ids rather than a flag on the passage itself: `Passage` is the shape that gets
	 * saved, published and synced, and a marker on it would have to be stripped in every
	 * one of those places.
	 */
	ghostIds?: Set<string>;
	/**
	 * Passage ID -> the name of whoever else has it open. Named differently from the
	 * card's own `lockedBy` on purpose: the spread below would otherwise hand each card
	 * the whole map where it expects one name.
	 */
	passageLocks?: Record<string, string>;
	passages: Passage[];
}

export const PassageCardGroup: React.FC<PassageCardGroupProps> = React.memo(
	props => {
		const {errorCounts, ghostIds, passageLocks, passages} = props;

		// What a card's scene strip needs to stage a patch scene (`from:`). Keyed on text
		// alone, so dragging cards around does not rebuild it--and handed only to the cards
		// that draw a strip, so it cannot break any other card's memo.

		const sceneSignature = passages
			.map(passage => `${passage.name}\u0000${passage.text.length}`)
			.join('\u0001');
		const scenePassages = React.useMemo<IndexedPassage[]>(
			// Depends on the signature, not on `passages`: the array is new on every move.
			() => passages.map(passage => ({name: passage.name, text: passage.text})),
			[sceneSignature]
		);

		// Passages must be sorted so that tabbing around follows a logical pattern.

		const sortedPassages = React.useMemo(
			() =>
				[...passages].sort((a, b) => {
					if (a.top !== b.top) {
						return a.top - b.top;
					}

					return a.left - b.left;
				}),
			[passages]
		);

		return (
			<TransitionGroup component={null}>
				{sortedPassages.map(passage => (
					<CSSTransition classNames="pop" key={passage.id} timeout={200}>
						<PassageCard
							errorCount={errorCounts?.[passage.id]}
							lockedBy={passageLocks?.[passage.id]}
							passage={passage}
							{...props}
							ghost={ghostIds?.has(passage.id)}
							scenePassages={
								passagePreviewsScene(passage) ? scenePassages : undefined
							}
						/>
					</CSSTransition>
				))}
			</TransitionGroup>
		);
	}
);

PassageCardGroup.displayName = 'PassageCardGroup';
