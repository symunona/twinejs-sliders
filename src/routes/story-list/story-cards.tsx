import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {useHistory} from 'react-router-dom';
import {CSSTransition, TransitionGroup} from 'react-transition-group';
import {CardGroup} from '../../components/container/card-group';
import {GhostStoryCard} from '../../components/story/ghost-story-card';
import {StoryCard} from '../../components/story/story-card';
import {StoryCardPresence} from '../../components/story/story-card-sync-badge';
import type {CheckoutProgress} from '../../store/persistence/server/checkout-story';
import type {
	StoryIndexEntry,
	SyncRecord
} from '../../store/persistence/server/server.types';
import {setPref, usePrefsContext} from '../../store/prefs';
import {Story, updateStory} from '../../store/stories';
import {useUndoableStoriesContext} from '../../store/undoable-stories';
import {Color} from '../../util/color';
import './story-cards.css';

/**
 * How wide a story card should render onscreen as.
 */
const cardWidth = '360px';

export interface StoryCardsProps {
	/** How far each in-flight checkout has got, 0 to 1, by story ID. */
	checkoutProgress?: Record<string, number | undefined>;
	/**
	 * Stories whose text has landed but whose art is still downloading, by story ID. Their
	 * cards show a loader and cannot be selected until the download ends.
	 */
	checkingOut?: Record<string, CheckoutProgress | undefined>;
	/** Stories on the server with no local copy. Drawn last, dimmed. */
	ghosts?: StoryIndexEntry[];
	onCheckOutGhost?: (entry: StoryIndexEntry) => Promise<unknown> | unknown;
	onSelectStory: (story: Story) => void;
	/** Other people in each story, keyed by story ID. */
	presence?: Record<string, StoryCardPresence[]>;
	/** Local stories that aren't checked out, in the user's sort order. */
	stories: Story[];
	/** Checked-out stories, pinned above everything else in the user's sort order. */
	syncedStories?: Story[];
	/** Sync bookkeeping, keyed by story ID. */
	syncRecords?: Record<string, SyncRecord>;
}

export const StoryCards: React.FC<StoryCardsProps> = props => {
	const {
		checkingOut,
		checkoutProgress,
		ghosts,
		onCheckOutGhost,
		onSelectStory,
		presence,
		stories,
		syncedStories,
		syncRecords
	} = props;
	const {dispatch: prefsDispatch, prefs} = usePrefsContext();
	const {dispatch: storiesDispatch} = useUndoableStoriesContext();
	const history = useHistory();
	const {t} = useTranslation();

	function handleChangeTagColor(tagName: string, color: Color) {
		prefsDispatch(
			setPref('storyTagColors', {
				...prefs.storyTagColors,
				[tagName]: color
			})
		);
	}

	function handleRemoveTag(story: Story, tagName: string) {
		storiesDispatch(
			updateStory(stories, story, {
				tags: story.tags.filter(tag => tag !== tagName)
			})
		);
	}

	const synced = syncedStories ?? [];
	const ghostEntries = ghosts ?? [];

	// A heading on a single group is noise--they only earn their place when there's
	// something to tell apart.

	const showHeadings =
		[synced.length, stories.length, ghostEntries.length].filter(
			length => length > 0
		).length > 1;

	function storyCards(list: Story[]) {
		return (
			<CardGroup columnWidth={cardWidth}>
				<TransitionGroup component={null}>
					{list.map(story => (
						<CSSTransition classNames="pop" key={story.id} timeout={200}>
							<StoryCard
								loading={checkingOut?.[story.id]}
								onChangeTagColor={handleChangeTagColor}
								onEdit={() => history.push(`/stories/${story.id}`)}
								onRemoveTag={name => handleRemoveTag(story, name)}
								onSelect={() => onSelectStory(story)}
								presence={presence?.[story.id]}
								story={story}
								storyTagColors={prefs.storyTagColors}
								syncRecord={syncRecords?.[story.id]}
							/>
						</CSSTransition>
					))}
				</TransitionGroup>
			</CardGroup>
		);
	}

	return (
		<>
			{synced.length > 0 && (
				<section className="story-cards-group" data-testid="story-group-synced">
					{showHeadings && (
						<h2 className="story-cards-group-heading">
							{t('routes.storyList.server.groupSynced')}
						</h2>
					)}
					{storyCards(synced)}
				</section>
			)}
			{stories.length > 0 && (
				<section className="story-cards-group" data-testid="story-group-local">
					{showHeadings && (
						<h2 className="story-cards-group-heading">
							{t('routes.storyList.server.groupLocal')}
						</h2>
					)}
					{storyCards(stories)}
				</section>
			)}
			{ghostEntries.length > 0 && (
				<section className="story-cards-group" data-testid="story-group-ghosts">
					{showHeadings && (
						<h2 className="story-cards-group-heading">
							{t('routes.storyList.server.groupGhosts')}
						</h2>
					)}
					<CardGroup columnWidth={cardWidth}>
						{ghostEntries.map(entry => (
							<GhostStoryCard
								entry={entry}
								key={entry.id}
								onCheckOut={() => onCheckOutGhost?.(entry)}
								progress={checkoutProgress?.[entry.id]}
							/>
						))}
					</CardGroup>
				</section>
			)}
		</>
	);
};
