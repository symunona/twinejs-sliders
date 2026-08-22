import * as React from 'react';
import {GhostStoryCardProps} from '../ghost-story-card';

export const GhostStoryCard: React.FC<GhostStoryCardProps> = props => (
	<div data-testid={`mock-ghost-story-card-${props.entry.id}`}>
		<button onClick={() => props.onCheckOut()}>onCheckOut</button>
	</div>
);
