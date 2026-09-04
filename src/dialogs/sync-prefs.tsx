import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {CardContent} from '../components/container/card';
import {DialogCard, DialogCardProps} from '../components/container/dialog-card';
import {BackendPrefs} from './app-prefs/backend-prefs';
import './app-prefs.css';

export const SyncPrefsDialog: React.FC<
	Omit<DialogCardProps, 'headerLabel'>
> = props => {
	const {t} = useTranslation();

	return (
		<DialogCard
			{...props}
			className="app-prefs-dialog"
			fixedSize
			headerLabel={t('dialogs.syncPrefs.title')}
		>
			<CardContent>
				<BackendPrefs />
			</CardContent>
		</DialogCard>
	);
};
