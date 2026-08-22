import * as React from 'react';
import {StoryCardsProps} from '../story-cards';

export const StoryCards = ({
	ghosts,
	stories,
	syncedStories
}: StoryCardsProps) => (
	<div data-testid="mock-story-cards">
		{(syncedStories ?? []).map(story => (
			<div
				data-testid="mock-synced-story-card"
				data-id={story.id}
				key={story.id}
			/>
		))}
		{stories.map(story => (
			<div data-testid="mock-story-card" data-id={story.id} key={story.id} />
		))}
		{(ghosts ?? []).map(ghost => (
			<div
				data-testid="mock-ghost-story-card"
				data-id={ghost.id}
				key={ghost.id}
			/>
		))}
	</div>
);
