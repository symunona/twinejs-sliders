/**
 * The story-wide speech bubble defaults, as a control panel over a vars section.
 *
 * Every control here writes ONE `sliders.bubble.*` variable into the start passage
 * (`src/util/story-bubble.ts`), because that is where the player reads it from — there is
 * no story-level field in Twine's format that a story format can see, and inventing one
 * would mean teaching publish, import and the archive about it. A vars line is the channel
 * Chapbook already has, and it has the property that matters most here: the author can see
 * what the dialog did, and undo it by hand.
 *
 * Which is also why it edits the START passage and no other. A default has to be set before
 * the first line is read, and the start passage is the one passage every reading passes
 * through.
 */

import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {
	BUBBLE_PRESETS,
	BUBBLE_SHAPES,
	BUBBLE_SIZINGS,
	BubbleStyle
} from '@sliders/scene-types';
import {CardContent} from '../../components/container/card';
import {TextInput} from '../../components/control/text-input';
import {TextSelect} from '../../components/control/text-select';
import {
	Story,
	passageWithId,
	updatePassage,
	useStoriesContext
} from '../../store/stories';
import {storyBubbleDefaults, writeStoryBubbleVars} from '../../util/story-bubble';

export interface StoryBubblePrefsProps {
	story: Story;
}

/** The empty option's value. `''` is a legal font name to nobody, but a select needs one. */
const NONE = '';

export const StoryBubblePrefs: React.FC<StoryBubblePrefsProps> = ({story}) => {
	const {dispatch, stories} = useStoriesContext();
	const {t} = useTranslation();
	const start = story.startPassage
		? passageWithId(stories, story.id, story.startPassage)
		: undefined;
	const style = React.useMemo(
		() => storyBubbleDefaults(story.passages) ?? {},
		[story.passages]
	);
	// The font is typed, so it is held while it is being typed and committed on blur:
	// dispatching per keystroke would put one undo entry in the passage's history per
	// letter, and re-render the preview of every scene in between.
	const [font, setFont] = React.useState<string | undefined>();

	React.useEffect(() => setFont(undefined), [story.id]);

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

	return (
		<CardContent>
			<div className="story-bubble-prefs">
				<TextSelect
					disabled={!start}
					onChange={event => set('as', event.target.value || undefined)}
					options={[
						{label: t('dialogs.storyDetails.bubbleNone'), value: NONE},
						...BUBBLE_SHAPES.map(shape => ({label: shape, value: shape})),
						...BUBBLE_PRESETS.map(preset => ({label: preset, value: preset}))
					]}
					value={style.as ?? NONE}
				>
					{t('dialogs.storyDetails.bubbleStyle')}
				</TextSelect>
				<TextSelect
					disabled={!start}
					onChange={event => set('sizing', event.target.value || undefined)}
					options={[
						{label: t('dialogs.storyDetails.bubbleNone'), value: NONE},
						...BUBBLE_SIZINGS.map(sizing => ({
							label: t(`dialogs.storyDetails.bubbleSizing_${sizing}`),
							value: sizing
						}))
					]}
					value={style.sizing ?? NONE}
				>
					{t('dialogs.storyDetails.bubbleSizing')}
				</TextSelect>
				<TextInput
					disabled={!start}
					onBlur={() => {
						if (font !== undefined) {
							set('font', font.trim() || undefined);
							setFont(undefined);
						}
					}}
					onChange={event => setFont(event.target.value)}
					onKeyDown={event => {
						if (event.key === 'Enter') {
							(event.target as HTMLInputElement).blur();
						}
					}}
					value={font ?? style.font ?? ''}
				>
					{t('dialogs.storyDetails.bubbleFont')}
				</TextInput>
			</div>
			<p className="story-bubble-prefs-note">
				{start
					? t('dialogs.storyDetails.bubbleExplanation', {passage: start.name})
					: t('dialogs.storyDetails.bubbleNoStart')}
			</p>
		</CardContent>
	);
};
