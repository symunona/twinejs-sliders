import * as React from 'react';
import {useTranslation} from 'react-i18next';

export interface StoryCardAuthorsProps {
	createdBy?: string;
	lastEditedBy?: string;
}

/**
 * Who made the story and who touched it last, as lines for a card's summary. Both names
 * come from the server index, so a story that was never synced draws nothing.
 */
export const StoryCardAuthors: React.FC<StoryCardAuthorsProps> = props => {
	const {createdBy, lastEditedBy} = props;
	const {t} = useTranslation();

	return (
		<>
			{createdBy && (
				<>
					<br />
					<span data-testid="story-card-created-by">
						{t('components.storyCard.createdBy', {name: createdBy})}
					</span>
				</>
			)}
			{lastEditedBy && (
				<>
					<br />
					<span data-testid="story-card-last-edited-by">
						{t('components.storyCard.lastEditedBy', {name: lastEditedBy})}
					</span>
				</>
			)}
		</>
	);
};
