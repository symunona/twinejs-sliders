import orderBy from 'lodash/orderBy';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {MainContent} from '../../components/container/main-content';
import {SafariWarningCard} from '../../components/error';
import {
	AppDonationDialog,
	DialogsContextProvider,
	useDialogsContext
} from '../../dialogs';
import {StoryCardPresence} from '../../components/story/story-card-sync-badge';
import {
	isCheckoutProgress,
	useServerSyncContext,
	type CheckoutProgress
} from '../../store/persistence/server';
import {usePrefsContext} from '../../store/prefs';
import {useDonationCheck} from '../../store/prefs/use-donation-check';
import {
	deselectAllStories,
	deselectStory,
	selectStory,
	useStoriesContext
} from '../../store/stories';
import {UndoableStoriesContextProvider} from '../../store/undoable-stories';
import {StoryListToolbar} from './toolbar/story-list-toolbar';
import {StoryCards} from './story-cards';
import {ClickAwayListener} from '../../components/click-away-listener';

export const InnerStoryListRoute: React.FC = () => {
	const {dispatch: dialogsDispatch} = useDialogsContext();
	const {dispatch: storiesDispatch, stories} = useStoriesContext();
	const {prefs} = usePrefsContext();
	const {actions, connected, ghosts, presence, progress, records} =
		useServerSyncContext();
	const {shouldShowDonationPrompt} = useDonationCheck();
	const {t} = useTranslation();

	const selectedStories = React.useMemo(
		() => stories.filter(story => story.selected),
		[stories]
	);

	// Story id -> everyone else in it. The card badge already had a slot for this; all
	// that was missing was somebody to fill it in.
	const storyPresence = React.useMemo(() => {
		const out: Record<string, StoryCardPresence[]> = {};

		for (const client of presence.clients) {
			if (!client.story || client.id === presence.selfId) {
				continue;
			}

			out[client.story] = [
				...(out[client.story] ?? []),
				{id: client.id, name: client.name}
			];
		}

		return out;
	}, [presence]);

	const visibleStories = React.useMemo(() => {
		const filteredStories =
			prefs.storyListTagFilter.length > 0
				? stories.filter(story =>
						story.tags.some(tag => prefs.storyListTagFilter.includes(tag))
					)
				: stories;

		switch (prefs.storyListSort) {
			case 'date':
				return orderBy(filteredStories, ['lastUpdate'], ['desc']);
			case 'name':
				return orderBy(filteredStories, 'name');
		}
	}, [prefs.storyListSort, prefs.storyListTagFilter, stories]);

	// Checked-out stories are pinned into their own group above everything else, in
	// whatever order the person chose for the rest of the library.

	const syncedStories = React.useMemo(
		() => visibleStories.filter(story => story.sync === true),
		[visibleStories]
	);

	const localStories = React.useMemo(
		() => visibleStories.filter(story => story.sync !== true),
		[visibleStories]
	);

	// Ghosts are what the server has and this browser doesn't. With no connection there is
	// no index to trust, so they simply aren't drawn.

	const visibleGhosts = React.useMemo(
		() => (connected ? orderBy(ghosts ?? [], ['updatedAt'], ['desc']) : []),
		[connected, ghosts]
	);

	const checkoutProgress = React.useMemo(() => {
		const result: Record<string, number | undefined> = {};

		for (const [storyId, value] of Object.entries(progress ?? {})) {
			result[storyId] =
				value && value.total > 0 ? value.done / value.total : undefined;
		}

		return result;
	}, [progress]);

	// A checkout writes the story before it writes the art (`checkoutStory`), so between
	// those two the card is a real card with half its pictures missing. Mark it loading
	// until the art lands: the card says so, and refuses to be selected or opened.

	const checkingOut = React.useMemo(() => {
		const result: Record<string, CheckoutProgress | undefined> = {};

		for (const [storyId, value] of Object.entries(progress ?? {})) {
			if (isCheckoutProgress(value)) {
				result[storyId] = value;
			}
		}

		return result;
	}, [progress]);

	// Any stories no longer visible should be deselected.

	React.useEffect(() => {
		for (const story of selectedStories) {
			if (story.selected && !visibleStories.includes(story)) {
				storiesDispatch(deselectStory(story));
			}
		}
	}, [selectedStories, stories, storiesDispatch, visibleStories]);

	// A story already selected when its checkout starts — a re-checkout of something in
	// the library — would otherwise leave the toolbar acting on it while it downloads.

	React.useEffect(() => {
		for (const story of selectedStories) {
			if (checkingOut[story.id]) {
				storiesDispatch(deselectStory(story));
			}
		}
	}, [checkingOut, selectedStories, storiesDispatch]);

	React.useEffect(() => {
		if (shouldShowDonationPrompt()) {
			dialogsDispatch({type: 'addDialog', component: AppDonationDialog});
		}
	}, [dialogsDispatch, shouldShowDonationPrompt]);

	return (
		<div className="story-list-route">
			<StoryListToolbar selectedStories={selectedStories} />
			<ClickAwayListener
				ignoreSelector=".story-card"
				onClickAway={() => storiesDispatch(deselectAllStories())}
			>
				<MainContent
					data-hotkey-scope="story-list"
					title={t(
						prefs.storyListTagFilter.length > 0
							? 'routes.storyList.taggedTitleCount'
							: 'routes.storyList.titleCount',
						{count: visibleStories.length}
					)}
				>
					<SafariWarningCard />
					<div className="stories">
						{stories.length === 0 && visibleGhosts.length === 0 ? (
							<p>{t('routes.storyList.noStories')}</p>
						) : (
							<StoryCards
								checkingOut={checkingOut}
								checkoutProgress={checkoutProgress}
								ghosts={visibleGhosts}
								onCheckOutGhost={entry => actions.checkout(entry.id)}
								onSelectStory={story => {
									if (!checkingOut[story.id]) {
										storiesDispatch(selectStory(story, true));
									}
								}}
								presence={storyPresence}
								stories={localStories}
								syncedStories={syncedStories}
								syncRecords={records}
							/>
						)}
					</div>
				</MainContent>
			</ClickAwayListener>
		</div>
	);
};

export const StoryListRoute: React.FC = () => (
	<UndoableStoriesContextProvider>
		<DialogsContextProvider>
			<InnerStoryListRoute />
		</DialogsContextProvider>
	</UndoableStoriesContextProvider>
);
