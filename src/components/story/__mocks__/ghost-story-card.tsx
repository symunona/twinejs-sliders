import * as React from 'react';
import {GhostStoryCardProps} from '../ghost-story-card';

export const GhostStoryCard: React.FC<GhostStoryCardProps> = props => (
	<div data-testid={`mock-ghost-story-card-${props.entry.id}`}>
		<button onClick={() => props.onCheckOut()}>onCheckOut</button>
		{props.onDelete && (
			<button onClick={() => props.onDelete?.()}>onDelete</button>
		)}
		<button onClick={() => props.onPeekCreated?.()}>onPeekCreated</button>
		{props.created && <span>created {props.created.at}</span>}
	</div>
);
