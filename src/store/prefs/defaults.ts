import {PrefsState} from './prefs.types';

export const defaults = (): PrefsState => ({
	appTheme: 'system',
	assetGeneratorAspect: '16:9',
	assetGeneratorModel: 'gemini:gemini-2.5-flash-image',
	codeEditorFontFamily: 'var(--font-monospaced)',
	codeEditorFontScale: 1,
	dialogWidth: 600,
	disabledStoryFormatEditorExtensions: [],
	donateShown: false,
	editorCursorBlinks: true,
	firstRunTime: new Date().getTime(),
	geminiApiKey: '',
	hotkeyOverrides: {},
	lastUpdateSeen: '',
	lastUpdateCheckTime: new Date().getTime(),
	locale:
		(window.navigator as any).userLanguage ||
		window.navigator.language ||
		(window.navigator as any).browserLanguage ||
		(window.navigator as any).systemLanguage ||
		'en-us',
	openAiApiKey: '',
	passageEditorFontFamily: 'var(--font-system)',
	passageEditorFontScale: 1,
	passageEditorToolbars: true,
	passageTagDisplay: 'color',
	proofingFormat: {
		name: 'Paperthin',
		version: '1.0.0'
	},
	storyFormat: {
		name: 'Sliders',
		version: '0.1.0'
	},
	storyFormatListFilter: 'current',
	storyListSort: 'name',
	storyListTagFilter: [],
	storyTagColors: {},
	useCodeMirror: true,
	welcomeSeen: false
});
