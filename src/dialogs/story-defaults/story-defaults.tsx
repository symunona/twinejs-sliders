/**
 * Defaults — what every line in this story looks like before anything narrower speaks up.
 *
 * Its own dialog rather than a block inside Story Details, which is where the bubble
 * controls started. Two reasons, and the second is the one that forced it:
 *
 *   - Story Details is about the story as a FILE: its format, its IFID, how many words it
 *     has. Which typeface the speech is lettered in is not that; it is a design decision
 *     the author will come back to, and burying it under a statistics table said otherwise.
 *   - There is now too much of it. Style, sizing, font, fill and stroke are five controls
 *     with previews attached, and previews need room. The details dialog is `fixedSize`.
 *
 * Every control writes ONE `sliders.bubble.*` variable into the START passage
 * (`src/util/story-bubble.ts`). There is no story-level field a story format can see —
 * inventing one would mean teaching publish, import and the archive about it — and a vars
 * line is the channel Chapbook already has. It also has the property that matters most
 * here: the author can see what the dialog did, and undo it by hand.
 *
 * The start passage and no other, because a default has to be set before the first line is
 * read, and the start passage is the one passage every reading passes through.
 */

import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {BUBBLE_SIZINGS, bubbleFontStack} from '@sliders/scene-types';
import type {BubbleStyle} from '@sliders/scene-types';
import {CardContent} from '../../components/container/card';
import {DialogCard} from '../../components/container/dialog-card';
import {TextSelect} from '../../components/control/text-select';
import {PreviewSelect} from '../../components/control/preview-select';
import {
	Story,
	passageWithId,
	storyWithId,
	updatePassage,
	useStoriesContext
} from '../../store/stories';
import {storyBubbleDefaults, writeStoryBubbleVars} from '../../util/story-bubble';
import {DialogComponentProps} from '../dialogs.types';
import {BubbleColorControl} from '../bubble-style/bubble-color-control';
import {
	BubbleFontSwatch,
	BubbleStyleSwatch,
	bubbleFontOptions,
	bubbleStyleOptions
} from '../bubble-style/bubble-previews';
import './story-defaults.css';

export interface StoryDefaultsDialogProps extends DialogComponentProps {
	storyId: string;
}

/** The empty option's value. No CSS colour, font or style is ever spelled `''`. */
const NONE = '';

export const StoryDefaultsDialog: React.FC<StoryDefaultsDialogProps> = props => {
	const {storyId, ...other} = props;
	const {stories} = useStoriesContext();
	const story = storyWithId(stories, storyId);
	const {t} = useTranslation();

	return (
		<DialogCard
			{...other}
			className="story-defaults-dialog"
			headerLabel={t('dialogs.storyDefaults.title', {story: story.name})}
		>
			{!other.collapsed && <StoryDefaults story={story} />}
		</DialogCard>
	);
};

export interface StoryDefaultsProps {
	story: Story;
}

export const StoryDefaults: React.FC<StoryDefaultsProps> = ({story}) => {
	const {dispatch, stories} = useStoriesContext();
	const {t} = useTranslation();
	const start = story.startPassage
		? passageWithId(stories, story.id, story.startPassage)
		: undefined;
	const style = React.useMemo(
		() => storyBubbleDefaults(story.passages) ?? {},
		[story.passages]
	);
	const disabled = !start;

	function write(next: BubbleStyle) {
		if (!start) {
			return;
		}

		dispatch(
			updatePassage(story, start, {
				text: writeStoryBubbleVars(start.text, next)
			})
		);
	}

	function set(key: keyof BubbleStyle, value: string | undefined) {
		const next = {...style};

		if (value) {
			(next as Record<string, unknown>)[key] = value;
		} else {
			delete next[key];
		}

		write(next);
	}

	/**
	 * The colours the swatches are drawn with.
	 *
	 * The story's own, so the style list shows each shape against the fill and stroke this
	 * story actually uses. Choosing a shape against the factory white and then discovering
	 * it on a red bubble is exactly the round trip previews exist to remove.
	 */
	const colors = {
		accent: style.accent,
		bg: style.bg,
		color: style.color,
		font: style.font
	};

	return (
		<CardContent>
			<div className="story-defaults">
				<PreviewSelect
					disabled={disabled}
					onChange={value => set('as', value || undefined)}
					options={bubbleStyleOptions({
						colors,
						emptyDetail: t('dialogs.storyDefaults.bubbleStyleNoneDetail'),
						emptyLabel: t('dialogs.storyDefaults.none')
					})}
					value={style.as ?? NONE}
				>
					{t('dialogs.storyDefaults.bubbleStyle')}
				</PreviewSelect>
				<PreviewSelect
					disabled={disabled}
					onChange={value => set('font', value || undefined)}
					options={bubbleFontOptions({
						current: style.font,
						customLabel: t('dialogs.storyDefaults.fontCustom'),
						emptyDetail: t('dialogs.storyDefaults.fontNoneDetail'),
						emptyLabel: t('dialogs.storyDefaults.none'),
						emptyPreview: (
							<BubbleFontSwatch
								label={t('dialogs.storyDefaults.fontSample')}
								stack={undefined}
							/>
						)
					})}
					searchable
					value={style.font ?? NONE}
				>
					{t('dialogs.storyDefaults.font')}
				</PreviewSelect>
				<BubbleColorControl
					clearLabel={t('dialogs.storyDefaults.clearColor')}
					disabled={disabled}
					editable
					onChange={value => set('bg', value)}
					placeholder={t('dialogs.storyDefaults.bgPlaceholder')}
					value={style.bg}
				>
					{t('dialogs.storyDefaults.bg')}
				</BubbleColorControl>
				<BubbleColorControl
					clearLabel={t('dialogs.storyDefaults.clearColor')}
					disabled={disabled}
					editable
					onChange={value => set('accent', value)}
					placeholder={t('dialogs.storyDefaults.accentPlaceholder')}
					value={style.accent}
				>
					{t('dialogs.storyDefaults.accent')}
				</BubbleColorControl>
				<TextSelect
					disabled={disabled}
					onChange={event => set('sizing', event.target.value || undefined)}
					options={[
						{label: t('dialogs.storyDefaults.none'), value: NONE},
						...BUBBLE_SIZINGS.map(sizing => ({
							label: t(`dialogs.storyDetails.bubbleSizing_${sizing}`),
							value: sizing
						}))
					]}
					value={style.sizing ?? NONE}
				>
					{t('dialogs.storyDefaults.bubbleSizing')}
				</TextSelect>
			</div>
			{/*
				One bubble, painted with everything above at once.

				The dropdowns each preview their own key in isolation, which is what makes
				them pickable and is not the same question as "what does a line in this story
				look like now". A fill that works under `comic` can be unreadable under
				`narrator`, and only the two together say so.
			*/}
			<div className="story-defaults-sample">
				<span className="story-defaults-sample-label">
					{t('dialogs.storyDefaults.sample')}
				</span>
				<BubbleStyleSwatch token={style.as ?? ''} {...colors} />
				<span
					className="story-defaults-sample-text"
					style={{fontFamily: bubbleFontStack(style.font)}}
				>
					{t('dialogs.storyDefaults.sampleLine')}
				</span>
			</div>
			<p className="story-defaults-note">
				{start
					? t('dialogs.storyDefaults.explanation', {passage: start.name})
					: t('dialogs.storyDefaults.noStart')}
			</p>
		</CardContent>
	);
};
