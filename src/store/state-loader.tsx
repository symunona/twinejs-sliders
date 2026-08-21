import * as React from 'react';
import {LoadingCurtain} from '../components/loading-curtain';
import {migrateLegacyAssets} from './migrate-legacy-assets';
import {usePersistence} from './persistence/use-persistence';
import {usePrefsContext} from './prefs';
import {useStoriesContext} from './stories';
import {useStoryFormatsContext} from './story-formats';
import {useStoriesRepair} from './use-stories-repair';

export const StateLoader: React.FC = ({children}) => {
	const [initing, setIniting] = React.useState(false);
	const [inited, setInited] = React.useState(false);
	const [prefsRepaired, setPrefsRepaired] = React.useState(false);
	const [formatsRepaired, setFormatsRepaired] = React.useState(false);
	const [storiesRepaired, setStoriesRepaired] = React.useState(false);
	const [assetsScoped, setAssetsScoped] = React.useState(false);
	const scopingAssets = React.useRef(false);
	const {dispatch: prefsDispatch, prefs: prefsState} = usePrefsContext();
	const {dispatch: storiesDispatch, stories: storiesState} =
		useStoriesContext();
	const {dispatch: formatsDispatch, formats: formatsState} =
		useStoryFormatsContext();
	const repairStories = useStoriesRepair();
	const {prefs, stories, storyFormats} = usePersistence();

	// Done in steps so that the repair action can see the inited state, and then
	// each repair action can see the results of the preceding ones.
	//
	// Repairs must go:
	// formats -> prefs (so it can repair bad format preferences) -> stories

	React.useEffect(() => {
		async function run() {
			if (!initing) {
				const formatsState = await storyFormats.load();
				const prefsState = await prefs.load();
				const storiesState = await stories.load();

				formatsDispatch({type: 'init', state: formatsState});
				prefsDispatch({type: 'init', state: prefsState});
				storiesDispatch({type: 'init', state: storiesState});
				setInited(true);
			}
		}

		run();
		setIniting(true);
	}, [
		formatsDispatch,
		inited,
		initing,
		prefs,
		prefsDispatch,
		stories,
		storiesDispatch,
		storyFormats
	]);

	React.useEffect(() => {
		if (inited && !formatsRepaired) {
			formatsDispatch({type: 'repair'});
			setFormatsRepaired(true);
		}
	}, [formatsDispatch, formatsRepaired, inited]);

	React.useEffect(() => {
		if (inited && formatsRepaired && !prefsRepaired) {
			prefsDispatch({type: 'repair', allFormats: formatsState});
			setPrefsRepaired(true);
		}
	}, [formatsRepaired, formatsState, inited, prefsDispatch, prefsRepaired]);

	React.useEffect(() => {
		if (inited && formatsRepaired && prefsRepaired && !storiesRepaired) {
			repairStories();
			setStoriesRepaired(true);
		}
	}, [
		formatsDispatch,
		formatsRepaired,
		formatsState,
		inited,
		prefsDispatch,
		prefsRepaired,
		prefsState.storyFormat.name,
		prefsState.storyFormat.version,
		repairStories,
		stories,
		storiesDispatch,
		storiesRepaired
	]);

	// Assets used to live in one library shared by every story. Each story's share is
	// copied into its own library before anything can open the asset manager and write to
	// one — see migrate-legacy-assets. Runs once per browser and no-ops after that.

	React.useEffect(() => {
		if (!storiesRepaired || assetsScoped || scopingAssets.current) {
			return;
		}

		scopingAssets.current = true;
		migrateLegacyAssets(storiesState)
			.then(report => {
				if (report.assets > 0 || report.characters > 0) {
					console.info(
						`Sliders: copied ${report.assets} asset(s) and ${report.characters} character(s) from the old shared library into ${report.stories} story/stories.`
					);
				}
			})
			.catch(error =>
				console.error('Sliders: could not scope the asset library', error)
			)
			.finally(() => setAssetsScoped(true));
	}, [assetsScoped, storiesRepaired, storiesState]);

	return inited &&
		formatsRepaired &&
		prefsRepaired &&
		storiesRepaired &&
		assetsScoped ? (
		<>{children}</>
	) : (
		<LoadingCurtain />
	);
};
