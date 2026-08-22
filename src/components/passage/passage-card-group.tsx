import * as React from 'react';
import {CSSTransition, TransitionGroup} from 'react-transition-group';
import {Passage} from '../../store/stories';
import {PassageCard, PassageCardProps} from './passage-card';
import '../../styles/animations.css';

export interface PassageCardGroupProps extends Omit<
	PassageCardProps,
	'errorCount' | 'lockedBy' | 'passage'
> {
	/** Passage ID -> scene error count, for the cards that have any. */
	errorCounts?: Record<string, number>;
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
		const {errorCounts, passageLocks, passages} = props;

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
						/>
					</CSSTransition>
				))}
			</TransitionGroup>
		);
	}
);

PassageCardGroup.displayName = 'PassageCardGroup';
