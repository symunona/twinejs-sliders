import * as React from 'react';
import {StoryCardSyncBadgeProps} from '../story-card-sync-badge';

export const StoryCardSyncBadge: React.FC<StoryCardSyncBadgeProps> = props =>
	props.record || props.sync ? (
		<div
			data-testid="mock-story-card-sync-badge"
			data-sync-state={props.record?.state ?? 'idle'}
		/>
	) : null;
