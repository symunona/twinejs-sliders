import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {presenceNames} from '../../../store/persistence/server/presence';
import {useServerSyncContext} from '../../../store/persistence/server/use-server-sync';
import './story-presence.css';

export interface StoryPresenceProps {
	storyId: string;
}

/**
 * Who else is in this story, as initials, in the toolbar.
 *
 * The element is always rendered, empty and invisible, rather than mounted when somebody
 * arrives: the E2E suite polls it, and more importantly a control that appears from
 * nowhere would shove the rest of the pinned toolbar sideways the moment a colleague
 * opened the story. Reserving the space costs nothing and moves nothing.
 */
export const StoryPresence: React.FC<StoryPresenceProps> = props => {
	const {storyId} = props;
	const {clientsIn} = useServerSyncContext();
	const {t} = useTranslation();
	const clients = clientsIn(storyId);
	const names = presenceNames(clients);

	return (
		<span
			className="story-presence"
			data-names={names.join(',')}
			data-testid="story-presence"
			title={
				names.length > 0
					? t('routes.storyEdit.presence.inStory', {names: names.join(', ')})
					: undefined
			}
		>
			{clients.map(client => (
				<span className="story-presence-initial" key={client.id}>
					{(client.name.trim()[0] ?? '?').toUpperCase()}
				</span>
			))}
		</span>
	);
};
