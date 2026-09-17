import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {CardContent} from '../components/container/card';
import {DialogCard, DialogCardProps} from '../components/container/dialog-card';
import {CheckboxButton} from '../components/control/checkbox-button';
import {FontSelect} from '../components/control/font-select';
import {TextSelect} from '../components/control/text-select';
import {
	insertSceneAutoAdvance,
	setInsertSceneAutoAdvance
} from './passage-edit/scene-preview/insert-scene-pref';
import {setPref, usePrefsContext} from '../store/prefs';
import {closestAppLocale, locales} from '../util/locales';
import './app-prefs.css';

export const AppPrefsDialog: React.FC<
	Omit<DialogCardProps, 'headerLabel'>
> = props => {
	const {dispatch, prefs} = usePrefsContext();
	const {t} = useTranslation();
	/**
	 * Not in the prefs store: this is a template seed for Insert Scene, kept in
	 * localStorage, and it never reaches a story file or the sync wire. State here only so
	 * the select redraws after a change — nothing else in the app reads it live.
	 */
	const [sceneAutoAdvance, setSceneAutoAdvance] = React.useState(
		insertSceneAutoAdvance
	);

	function handleSceneAutoAdvanceChange(value: string) {
		const seconds = value === '' ? undefined : Number(value);

		setInsertSceneAutoAdvance(seconds);
		setSceneAutoAdvance(seconds);
	}

	function handleUseCodeMirrorChange(value: boolean) {
		dispatch(setPref('useCodeMirror', value));

		// If we're disabling CodeMirror, force cursor blinking on because we no longer control it.

		if (!value) {
			dispatch(setPref('editorCursorBlinks', true));
		}
	}

	return (
		<DialogCard
			{...props}
			className="app-prefs-dialog"
			fixedSize
			headerLabel={t('dialogs.appPrefs.title')}
		>
			<CardContent>
				<TextSelect
					onChange={e => dispatch(setPref('locale', e.target.value))}
					options={locales.map(locale => ({
						label: locale.name,
						value: locale.code
					}))}
					value={closestAppLocale(prefs.locale)}
				>
					{t('dialogs.appPrefs.language')}
				</TextSelect>
				<TextSelect
					onChange={e => dispatch(setPref('appTheme', e.target.value))}
					options={[
						{label: t('dialogs.appPrefs.themeSystem'), value: 'system'},
						{label: t('dialogs.appPrefs.themeLight'), value: 'light'},
						{label: t('dialogs.appPrefs.themeDark'), value: 'dark'}
					]}
					value={prefs.appTheme}
				>
					{t('dialogs.appPrefs.theme')}
				</TextSelect>
				<TextSelect
					onChange={e =>
						dispatch(setPref('dialogWidth', parseInt(e.target.value)))
					}
					options={[
						{label: t('dialogs.appPrefs.dialogWidths.default'), value: '600'},
						{label: t('dialogs.appPrefs.dialogWidths.wider'), value: '700'},
						{label: t('dialogs.appPrefs.dialogWidths.widest'), value: '800'}
					]}
					value={prefs.dialogWidth.toString()}
				>
					{t('dialogs.appPrefs.dialogWidth')}
				</TextSelect>
				<TextSelect
					onChange={e => dispatch(setPref('passageTagDisplay', e.target.value))}
					options={[
						{
							label: t('dialogs.appPrefs.passageTagDisplays.color'),
							value: 'color'
						},
						{
							label: t('dialogs.appPrefs.passageTagDisplays.name'),
							value: 'name'
						}
					]}
					value={prefs.passageTagDisplay}
				>
					{t('dialogs.appPrefs.passageTagDisplay')}
				</TextSelect>
				<TextSelect
					onChange={e => handleSceneAutoAdvanceChange(e.target.value)}
					options={[
						{label: t('dialogs.appPrefs.sceneAutoAdvances.reader'), value: ''},
						{label: t('dialogs.appPrefs.sceneAutoAdvances.click'), value: '0'},
						...['1', '1.5', '2', '3', '5'].map(value => ({
							label: t('dialogs.appPrefs.sceneAutoAdvances.seconds', {value}),
							value
						}))
					]}
					value={sceneAutoAdvance === undefined ? '' : String(sceneAutoAdvance)}
				>
					{t('dialogs.appPrefs.sceneAutoAdvance')}
				</TextSelect>
				<p className="app-prefs-explanation">
					{t('dialogs.appPrefs.sceneAutoAdvanceExplanation')}
				</p>
				<CheckboxButton
					disabled={!prefs.useCodeMirror}
					label={t('dialogs.appPrefs.editorCursorBlinks')}
					onChange={value => dispatch(setPref('editorCursorBlinks', value))}
					value={prefs.editorCursorBlinks}
				/>
				<CheckboxButton
					label={t('dialogs.appPrefs.useEnhancedEditors')}
					onChange={handleUseCodeMirrorChange}
					value={prefs.useCodeMirror}
				/>
				<p className="font-explanation">
					{t('dialogs.appPrefs.fontExplanation')}
				</p>
				<FontSelect
					familyLabel={t('dialogs.appPrefs.passageEditorFont')}
					fontFamily={prefs.passageEditorFontFamily}
					fontScale={prefs.passageEditorFontScale}
					onChangeFamily={value =>
						dispatch(setPref('passageEditorFontFamily', value))
					}
					onChangeScale={value =>
						dispatch(setPref('passageEditorFontScale', value))
					}
					scaleLabel={t('dialogs.appPrefs.passageEditorFontScale')}
				/>
				<FontSelect
					familyLabel={t('dialogs.appPrefs.codeEditorFont')}
					fontFamily={prefs.codeEditorFontFamily}
					fontScale={prefs.codeEditorFontScale}
					onChangeFamily={value =>
						dispatch(setPref('codeEditorFontFamily', value))
					}
					onChangeScale={value =>
						dispatch(setPref('codeEditorFontScale', value))
					}
					scaleLabel={t('dialogs.appPrefs.codeEditorFontScale')}
				/>
			</CardContent>
		</DialogCard>
	);
};
