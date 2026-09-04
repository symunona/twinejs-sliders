import {IconAlertTriangle, IconCloud, IconCloudOff} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {MenuButton} from '../components/control/menu-button';
import {SyncPrefsDialog, useDialogsContext} from '../dialogs';
import {useServerSyncContext} from '../store/persistence/server/use-server-sync';
import {Story} from '../store/stories';
import './sync-menu-button.css';

export interface SyncMenuButtonProps {
	/** The story Publish/Unpublish acts on. Omitted when none is unambiguously selected. */
	story?: Story;
}

export const SyncMenuButton: React.FC<SyncMenuButtonProps> = props => {
	const {story} = props;
	const {dispatch} = useDialogsContext();
	const {actions, client, connected, lastError} = useServerSyncContext();
	const {t} = useTranslation();

	const configured = client !== undefined;
	const ok = configured && connected;

	const icon = ok ? (
		<IconCloud />
	) : (
		<span className="sync-menu-button-icon">
			<IconCloudOff />
			{configured && (
				<IconAlertTriangle className="sync-menu-button-alert" />
			)}
		</span>
	);
	const label: string = ok
		? t('routeActions.app.sync')
		: configured
			? (lastError ?? t('routeActions.app.syncDisconnected'))
			: t('routeActions.app.syncNotConfigured');

	return (
		<MenuButton
			icon={icon}
			items={[
				...(story
					? [
							story.sync === true
								? {
										label: t('routeActions.app.syncUnpublish'),
										onClick: () => actions.setSync(story, false)
									}
								: {
										label: t('routeActions.app.syncPublish'),
										onClick: () => actions.publish(story)
									},
							{separator: true as const}
						]
					: []),
				{
					label: t('routeActions.app.syncSettings'),
					onClick: () =>
						dispatch({type: 'addDialog', component: SyncPrefsDialog})
				}
			]}
			label={label}
		/>
	);
};
