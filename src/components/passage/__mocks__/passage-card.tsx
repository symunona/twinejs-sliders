import * as React from 'react';
import {PassageCardProps} from '../passage-card';

export const PassageCard: React.FC<PassageCardProps> = ({ghost, passage}) => (
	<div data-testid={`mock-passage-card-${passage.name}`} data-ghost={ghost} />
);
