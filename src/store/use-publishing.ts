import * as React from 'react';
import {
	publishArchive,
	publishStory,
	publishStoryWithFormat,
	PublishOptions
} from '../util/publish';
import {usePrefsContext} from './prefs';
import {
	formatWithNameAndVersion,
	loadFormatProperties,
	useStoryFormatsContext
} from './story-formats';
import {storyWithId, useStoriesContext} from './stories';
import {getAppInfo} from '../util/app-info';
import {slidersAssetStore} from '../dialogs/sliders-assets/asset-store-context';
import {SlidersUrlFlavor, withSlidersManifests} from '../util/sliders-manifest';

export interface StoryPublishOptions extends PublishOptions {
	/**
	 * How the Sliders asset manifests address their bytes. Defaults to `data`, which is
	 * the only flavour that survives the HTML leaving this origin — a download or an
	 * Electron scratch file. Callers that replace the DOM of the tab doing the publishing
	 * should pass `blob` instead; see `util/sliders-manifest`.
	 */
	slidersUrls?: SlidersUrlFlavor;
}

export interface UsePublishingProps {
	proofStory: (storyId: string) => Promise<string>;
	publishArchive: (storyIds?: string[]) => Promise<string>;
	publishStory: (
		storyId: string,
		publishOptions?: StoryPublishOptions
	) => Promise<string>;
	publishStoryData: (storyId: string) => string;
}

/**
 * A React hook to publish stories from context. You probably want to use
 * `useStoryLaunch` instead--this is for doing the actual binding of the story
 * and story format.
 */
export function usePublishing(): UsePublishingProps {
	// As little logic as possible should live here--instead it should be in
	// util/publish.ts.

	const {prefs} = usePrefsContext();
	const {dispatch: storyFormatsDispatch, formats} = useStoryFormatsContext();
	const {stories} = useStoriesContext();

	return {
		publishArchive: React.useCallback(
			async () => publishArchive(stories, getAppInfo()),
			[stories]
		),
		proofStory: React.useCallback(
			async storyId => {
				const story = storyWithId(stories, storyId);
				const format = formatWithNameAndVersion(
					formats,
					prefs.proofingFormat.name,
					prefs.proofingFormat.version
				);
				const formatProperties = await loadFormatProperties(format)(
					storyFormatsDispatch
				);

				if (!formatProperties) {
					throw new Error(`Couldn't load story format properties`);
				}

				return publishStoryWithFormat(
					story,
					formatProperties.source,
					getAppInfo()
				);
			},
			[
				formats,
				prefs.proofingFormat.name,
				prefs.proofingFormat.version,
				stories,
				storyFormatsDispatch
			]
		),
		publishStory: React.useCallback(
			async (storyId, publishOptions) => {
				const story = storyWithId(stories, storyId);
				const format = formatWithNameAndVersion(
					formats,
					story.storyFormat,
					story.storyFormatVersion
				);
				const formatProperties = await loadFormatProperties(format)(
					storyFormatsDispatch
				);

				if (!formatProperties) {
					throw new Error(`Couldn't load story format properties`);
				}

				// The Sliders manifests ride only on this path. The archive, the proofing
				// format and Electron's save-on-change all publish elsewhere, and none of
				// them should carry a copy of the story's art.
				return publishStoryWithFormat(
					await withSlidersManifests(story, slidersAssetStore(story.id), {
						urls: publishOptions?.slidersUrls ?? 'data'
					}),
					formatProperties.source,
					getAppInfo(),
					publishOptions
				);
			},
			[formats, stories, storyFormatsDispatch]
		),
		publishStoryData: React.useCallback(
			(storyId: string) => {
				const story = storyWithId(stories, storyId);

				return publishStory(story, getAppInfo(), {startOptional: true});
			},
			[stories]
		)
	};
}
