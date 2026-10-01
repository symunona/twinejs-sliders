import {i18n} from '../../util/i18n';
import {passagePreviewsScene} from '../../util/passage-sizes';
import {Passage, Story} from './stories.types';

export const passageDefaults = (): Omit<Passage, 'id' | 'story'> => ({
	height: 100,
	highlighted: false,
	left: 0,
	name: i18n.t('store.passageDefaults.name'),
	selected: false,
	tags: [],
	text: '',
	top: 0,
	width: 100
});

/**
 * The size a passage created right now should take, whichever gesture creates it.
 *
 * Follows the story: once ANY passage in it is sized to show its scene, this author is
 * writing with scene pictures on the map, and a new passage that came up 100x100 would
 * have to be resized by hand every single time. A size is the only record of that
 * preference--nothing on the story says "I draw scenes"--so the existing cards are the
 * setting.
 *
 * Shared by `createUntitledPassage`, `newPassagePositions` and the ghost cards, or a
 * ghost would be drawn at one size and created at another.
 */
export function newPassageSize(passages: {height: number; width: number}[]): {
	height: number;
	width: number;
} {
	// Whichever scene size the story already uses, so a preview-only map stays one.
	const previewing = passages.find(passagePreviewsScene);

	if (previewing) {
		return {height: previewing.height, width: previewing.width};
	}

	const defaults = passageDefaults();

	return {height: defaults.height, width: defaults.width};
}

export const storyDefaults = (): Omit<Story, 'id'> => ({
	ifid: '',
	lastUpdate: new Date(),
	passages: [],
	name: i18n.t('store.storyDefaults.name'),
	script: '',
	selected: false,
	snapToGrid: true,
	startPassage: '',
	storyFormat: '',
	storyFormatVersion: '',
	stylesheet: '',
	tags: [],
	tagColors: {},
	zoom: 1
});
