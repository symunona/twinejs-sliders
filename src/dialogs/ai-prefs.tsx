import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {CardContent} from '../components/container/card';
import {DialogCard, DialogCardProps} from '../components/container/dialog-card';
import {TextInput} from '../components/control/text-input';
import {setPref, usePrefsContext} from '../store/prefs';
import './app-prefs.css';

export const AiPrefsDialog: React.FC<
	Omit<DialogCardProps, 'headerLabel'>
> = props => {
	const {dispatch, prefs} = usePrefsContext();
	const {t} = useTranslation();

	return (
		<DialogCard
			{...props}
			className="app-prefs-dialog"
			fixedSize
			headerLabel={t('dialogs.aiPrefs.title')}
		>
			<CardContent>
				<p className="font-explanation">
					{t('dialogs.appPrefs.assetGeneratorExplanation')}
				</p>
				<TextInput
					onChange={e => dispatch(setPref('geminiApiKey', e.target.value))}
					orientation="vertical"
					placeholder={t('dialogs.appPrefs.apiKeyPlaceholder')}
					type="password"
					value={prefs.geminiApiKey}
				>
					{t('dialogs.appPrefs.geminiApiKey')}
				</TextInput>
				<TextInput
					onChange={e => dispatch(setPref('openAiApiKey', e.target.value))}
					orientation="vertical"
					placeholder={t('dialogs.appPrefs.apiKeyPlaceholder')}
					type="password"
					value={prefs.openAiApiKey}
				>
					{t('dialogs.appPrefs.openAiApiKey')}
				</TextInput>
			</CardContent>
		</DialogCard>
	);
};
