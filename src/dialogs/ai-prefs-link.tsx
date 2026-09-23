import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {AiPrefsDialog} from './ai-prefs';
import {useDialogsContext} from './context';
import './ai-prefs-link.css';

/**
 * Opens AI preferences from wherever a missing key was noticed.
 *
 * A warning that names a preference the author then has to go and find is a warning that
 * gets read twice and acted on once. This is the same dispatch the app menu makes, so the
 * dialog that opens is the one they would have opened themselves.
 */
export function useOpenAiPrefs(): () => void {
	const {dispatch} = useDialogsContext();

	return React.useCallback(
		() => dispatch({type: 'addDialog', component: AiPrefsDialog}),
		[dispatch]
	);
}

export const AiPrefsLink: React.FC<{label?: string}> = ({label}) => {
	const openAiPrefs = useOpenAiPrefs();
	const {t} = useTranslation();

	return (
		<button className="ai-prefs-link" onClick={openAiPrefs} type="button">
			{label ?? t('dialogs.aiPrefs.open')}
		</button>
	);
};
