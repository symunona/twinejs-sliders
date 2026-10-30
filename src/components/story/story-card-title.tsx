import * as React from 'react';
import {useTranslation} from 'react-i18next';
import type {StoryCreated} from '../../store/persistence/server/story-created';

const dateFormatter = new Intl.DateTimeFormat([]);

export interface StoryCardTitleProps {
	/** Unknown until `onPeek` has fetched it, and for stories the server never saw. */
	created?: StoryCreated;
	name: string;
	/**
	 * Asks for `created`. Called on hover, not on render: the date costs a revisions
	 * request per story, and nobody wants twenty of those to draw the library.
	 */
	onPeek?: () => void;
}

/** A card's heading. Its hover tooltip says when the story was created. */
export const StoryCardTitle: React.FC<StoryCardTitleProps> = props => {
	const {created, name, onPeek} = props;
	const {t} = useTranslation();
	let title: string | undefined;

	if (created) {
		const at = new Date(created.at);

		if (!Number.isNaN(at.getTime())) {
			title = t(
				created.exact
					? 'components.storyCard.createdOn'
					: 'components.storyCard.createdOnOrBefore',
				{date: dateFormatter.format(at)}
			);
		}
	}

	return (
		<h2 data-testid="story-card-title" onMouseEnter={onPeek} title={title}>
			{name}
		</h2>
	);
};
