/**
 * This module intentionally does not affect anything in state except for
 *  `trail`. Putting the entire story into state would waste space and behave
 * unpredictably, as change events would not necessarily trigger correctly.
 * @packageDocumentation
 */

import {matchPassageName} from '@sliders/scene-types';
import {createLoggers} from '../logger';
import {setDefaults} from '../state';
import {Story} from './types';

const logger = createLoggers('story');

const story: Story = {
	customScripts: [],
	customStyles: [],
	passages: []
};

/**
 * Loads passage and story data from an HTML <tw-storydata> element.
 */
export function loadFromData(el: HTMLElement) {
	for (const attr of ['name', 'creator', 'ifid', 'options']) {
		// This cast needed because some properties of `story` are not strings.

		story[attr as keyof Pick<Story, 'name' | 'creator' | 'ifid' | 'options'>] =
			el.getAttribute(attr) ?? undefined;
	}

	// Camel-case creator version and start node.

	const startNode = parseInt(el.getAttribute('startnode') ?? '');

	if (!isNaN(startNode)) {
		story.startNode = startNode;
	}

	story.creatorVersion = el.getAttribute('creator-version') ?? undefined;

	// Custom script and style.

	const elsToContents = (els: NodeListOf<HTMLElement>) =>
		[...els].map(el => el.textContent ?? '');

	story.customScripts = elsToContents(
		el.querySelectorAll('[type="text/twine-javascript"]')
	);
	story.customStyles = elsToContents(
		el.querySelectorAll('[type="text/twine-css"]')
	);

	// Create passages.

	story.passages = [...el.querySelectorAll('tw-passagedata')].map(passage => {
		const id = parseInt(passage.getAttribute('pid') ?? '');
		const tagAttr = passage.getAttribute('tags');

		return {
			id: !isNaN(id) ? id : undefined,
			name: passage.getAttribute('name') ?? undefined,
			source: passage.textContent ?? '',
			tags: tagAttr ? tagAttr.split(' ') : []
		};
	});
}

/**
 * Sets up state. This *must* be called after `loadFromData()`.
 */
export function initStory() {
	const start = startPassage();

	if (!start || !start.name) {
		throw new Error(
			'There is no starting passage for this story, or it has no name.'
		);
	}

	setDefaults({
		trail: [start.name],
		'config.testing':
			(typeof story.options === 'string' &&
				story.options.indexOf('debug') !== -1) ||
			process.env.NODE_ENV !== 'production'
	});

	if (story.name) {
		document.title = story.name;
	}
}

/**
 * Runs any custom scripts set in the story.
 */
export function runCustomScripts() {
	logger.log(`Running custom scripts (${story.customScripts.length})`);

	for (const script of story.customScripts) {
		new Function(script).apply(window);
	}
}

/**
 * Adds any custom styles set in the story to the DOM.
 */
export function addCustomStyles() {
	logger.log(`Adding custom styles (${story.customStyles.length})`);

	for (const style of story.customStyles) {
		const styleEl = document.createElement('style');

		styleEl.innerHTML = style;
		document.head.appendChild(styleEl);
	}
}

/**
 * Returns the IFID of the story.
 */
export function ifid() {
	return story.ifid;
}

/**
 * Returns the name of the story.
 */
export function name() {
	return story.name;
}

/**
 * Returns all passages in the story.
 */
export function passages() {
	return story.passages;
}

/**
 * Returns the start passage of the story. If none exists, returns undefined.
 */
export function startPassage() {
	return story.passages.find(p => p.id === story.startNode);
}

/**
 * Returns the passage with the passed name. If none exists by this name, returns undefined.
 *
 * Name matching is EXACT first, then case-insensitive (`matchPassageName`). Chapbook's
 * `go()` throws on a miss and the throw reaches `window.onerror`, so a `links:` entry
 * saying `Back: Start` against a passage called `start` used to end the reader's session
 * on the error screen — while the story map drew the arrow and the editor said nothing
 * worse than a ghost card. One spelling mistake should not be fatal.
 *
 * This is a Sliders edit into a vendored Chapbook file; it is in the `format/README.md`
 * table. Every name-based lookup in the player goes through here — links, `{embed
 * passage}`, reveal links, the trail restore — so they cannot disagree.
 */
export function passageNamed(name: string) {
	// A passage whose `name` attribute was missing has no name to match, and folding
	// `undefined` throws inside `matchPassageName`. Drop those here rather than widening
	// the shared matcher, which the editor also calls with real names only.
	const matched = matchPassageName(
		story.passages
			.map(p => p.name)
			.filter((passageName): passageName is string => passageName !== undefined),
		name
	);

	if (matched === undefined) {
		return undefined;
	}

	if (matched !== name) {
		logger.warn(
			`Passage "${matched}" was found for "${name}", which differs only in case.`
		);
	}

	return story.passages.find(p => p.name === matched);
}

/**
 * Returns the passage with the ID passed. If none exists with this ID, returns
 * undefined.
 */
export function passageWithId(id: number) {
	return story.passages.find(p => p.id === id);
}
