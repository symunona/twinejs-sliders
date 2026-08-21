import {v4 as uuid} from '@lukeed/uuid';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {CardContent} from '../../components/container/card';
import {
	DialogCard,
	DialogCardProps
} from '../../components/container/dialog-card';
import {storyFileName} from '../../electron/shared';
import {importStories, Story, useStoriesContext} from '../../store/stories';
import {useStoriesRepair} from '../../store/use-stories-repair';
import {
	applyBundlePlan,
	BundleContents,
	BundlePlan,
	planBundle,
	readStoryBundle
} from '../../util/sliders-bundle';
import {
	refreshAssetLibrary,
	slidersAssetStore
} from '../sliders-assets/asset-store-context';

import {BundleReport} from './bundle-report';
import {FileChooser} from './file-chooser';
import {StoryChooser} from './story-chooser';
import './story-import.css';

export type StoryImportDialogProps = Omit<DialogCardProps, 'headerLabel'>;

/**
 * Pins down the id each of a bundle's stories will have once imported.
 *
 * Assets live in a library per story id, so the bundle's art has to be written under the
 * id the story is going to get — which means picking it here, before anything is written.
 * A bundle that overwrites a story it recognises by filename inherits that story's id and
 * therefore its library; anything else is a new story with a new id and an empty one.
 */
function withTargetIds(stories: Story[], existingStories: Story[]): Story[] {
	return stories.map(story => {
		const existing = existingStories.find(
			candidate => storyFileName(candidate) === storyFileName(story)
		);

		return {...story, id: existing ? existing.id : uuid()};
	});
}

export const StoryImportDialog: React.FC<StoryImportDialogProps> = props => {
	const {onClose} = props;
	const {t} = useTranslation();
	const repairStories = useStoriesRepair();
	const {dispatch, stories: existingStories} = useStoriesContext();
	const [file, setFile] = React.useState<File>();
	/**
	 * The library the bundle's assets go into: the story it carries, not a shared pile.
	 * Picked when the bundle is read, so the plan the author approves is the plan that runs.
	 */
	const [bundleScope, setBundleScope] = React.useState<string>();
	const [stories, setStories] = React.useState<Story[]>([]);
	const [bundle, setBundle] = React.useState<BundleContents>();
	const [plan, setPlan] = React.useState<BundlePlan>();
	const [bundleError, setBundleError] = React.useState<Error>();
	const [busy, setBusy] = React.useState(false);

	function handleImport(stories: Story[], keepIds = false) {
		dispatch(importStories(stories, existingStories, {keepIds}));
		repairStories();
		onClose();
	}

	function handleFileChange(file: File, stories: Story[], keepIds = false) {
		// If there are no conflicts in the stories, import them now. Otherwise, set
		// them in state and let the user choose via <StoryChooser>.

		if (
			stories.length === 0 ||
			stories.some(story =>
				existingStories.some(
					existing => storyFileName(existing) === storyFileName(story)
				)
			)
		) {
			setFile(file);
			setStories(stories);
		} else {
			handleImport(stories, keepIds);
		}
	}

	function resetBundle() {
		setBundle(undefined);
		setBundleError(undefined);
		setBundleScope(undefined);
		setPlan(undefined);
	}

	async function handleChooseBundle(file: File) {
		setBusy(true);
		resetBundle();
		setStories([]);

		// Reading and planning both stop short of writing anything, so the author sees
		// every clash before the library changes.

		try {
			const read = await readStoryBundle(file);
			// readStoryBundle throws when a bundle carries no story, so there is always
			// one here, and its library is the one the assets belong in. A bundle holds a
			// single story by construction; if a future one ever holds more, the first is
			// the one the manifest describes.
			const contents = {
				...read,
				stories: withTargetIds(read.stories, existingStories)
			};
			const scope = contents.stories[0].id;
			const plan = await planBundle(slidersAssetStore(scope), contents);

			setFile(file);
			setBundle(contents);
			setBundleScope(scope);
			setPlan(plan);
		} catch (error) {
			setBundleError(error as Error);
		} finally {
			setBusy(false);
		}
	}

	async function handleApplyBundle() {
		if (!bundle || !plan || !file || bundleScope === undefined) {
			return;
		}

		setBusy(true);

		try {
			// Assets first: once the story lands, its scenes have to resolve against a
			// library that already holds them.

			await applyBundlePlan(slidersAssetStore(bundleScope), plan);
			refreshAssetLibrary();
			resetBundle();
			handleFileChange(file, bundle.stories, true);
		} catch (error) {
			setBundleError(error as Error);
		} finally {
			setBusy(false);
		}
	}

	function handleCancelBundle() {
		resetBundle();
		setFile(undefined);
	}

	return (
		<DialogCard
			{...props}
			className="story-import-dialog"
			fixedSize
			headerLabel={t('dialogs.storyImport.title')}
		>
			<CardContent>
				{!plan && (
					<FileChooser
						onChange={handleFileChange}
						onChooseBundle={handleChooseBundle}
					/>
				)}
				{busy && !plan && (
					// Unzipping and hashing a large bundle takes long enough that a dialog
					// with nothing in it reads as a dialog that did nothing.
					<p className="bundle-reading">
						{t('dialogs.storyImport.bundleReading')}
					</p>
				)}
				{bundleError && (
					<p className="bundle-error">
						{t('dialogs.storyImport.bundleError', {
							message: bundleError.message
						})}
					</p>
				)}
				{plan && bundle && (
					<BundleReport
						busy={busy}
						onCancel={handleCancelBundle}
						onImport={handleApplyBundle}
						plan={plan}
						storyName={bundle.stories[0]?.name ?? bundle.manifest.story.name}
						warnings={bundle.warnings}
					/>
				)}
				{!plan && file && stories.length > 0 && (
					<StoryChooser
						existingStories={existingStories}
						onImport={handleImport}
						stories={stories}
					/>
				)}
				{!plan && !bundleError && file && stories.length === 0 && (
					<p>{t('dialogs.storyImport.noStoriesInFile')}</p>
				)}
			</CardContent>
		</DialogCard>
	);
};
