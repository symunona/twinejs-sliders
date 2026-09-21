import {brokenLinkGhosts} from '../broken-link-ghosts';
import {fakePassage, fakeStory} from '../../test-util';
import {Passage, Story} from '../../store/stories';
import {passageSizes} from '../passage-sizes';
import {rectsIntersect} from '../geometry';

function storyOf(passages: Passage[]): Story {
	return {...fakeStory(0), passages};
}

const scene = (links: string[]) =>
	['[scene]', 'id: here', 'links:', ...links.map(one => `  ${one}`)].join('\n');

describe('brokenLinkGhosts()', () => {
	it('returns nothing when every link target exists', () => {
		const start = fakePassage({name: 'Start', text: scene(['on: Street'])});
		const street = fakePassage({name: 'Street', text: 'Prose.'});

		expect(brokenLinkGhosts(storyOf([start, street]))).toEqual([]);
	});

	it('names a ghost for a scene link with no passage behind it', () => {
		const start = fakePassage({name: 'Start', text: scene(['on: Street'])});
		const ghosts = brokenLinkGhosts(storyOf([start]));

		expect(ghosts).toHaveLength(1);
		expect(ghosts[0].name).toBe('Street');
	});

	// A ghost is an ordinary passage so the map can draw it with the ordinary card, and
	// `story: ''` is what stops it being mistaken for one of the story's own: every store
	// action looks its passage up by story id and throws instead of writing.
	it('is a passage of no story, with no text', () => {
		const start = fakePassage({name: 'Start', text: scene(['on: Street'])});
		const story = storyOf([start]);
		const [ghost] = brokenLinkGhosts(story);

		expect(ghost.story).toBe('');
		expect(ghost.text).toBe('');
		expect(ghost.selected).toBe(false);
		expect(story.passages).toEqual([start]);
	});

	it('covers plain [[…]] links too', () => {
		const start = fakePassage({name: 'Start', text: 'Go [[Cellar]].'});

		expect(brokenLinkGhosts(storyOf([start])).map(one => one.name)).toEqual([
			'Cellar'
		]);
	});

	it('ignores external links', () => {
		const start = fakePassage({
			name: 'Start',
			text: scene(['out: https://example.com'])
		});

		expect(brokenLinkGhosts(storyOf([start]))).toEqual([]);
	});

	it('ignores a link to the passage itself', () => {
		const start = fakePassage({name: 'Start', text: scene(['again: Start'])});

		expect(brokenLinkGhosts(storyOf([start]))).toEqual([]);
	});

	it('makes one ghost for a name several passages link to', () => {
		const start = fakePassage({name: 'Start', text: scene(['on: Street'])});
		const other = fakePassage({name: 'Other', text: 'Go [[Street]].'});
		const ghosts = brokenLinkGhosts(storyOf([start, other]));

		expect(ghosts).toHaveLength(1);
		expect(ghosts[0].name).toBe('Street');
	});

	// The ghost is created at exactly the rect it was drawn at, so it has to be drawn at
	// the size creation would give it--otherwise the card jumps on click.
	it('draws a ghost at the size a new passage would take', () => {
		const start = fakePassage({
			height: 100,
			left: 0,
			name: 'Start',
			text: scene(['on: Street']),
			top: 0,
			width: 100
		});
		const previewing = fakePassage({
			...passageSizes.largeWithPreview,
			left: 5000,
			name: 'Elsewhere',
			text: 'Prose.',
			top: 5000
		});
		const [plain] = brokenLinkGhosts(storyOf([start]));

		expect(plain.height).toBe(passageSizes.small.height);
		expect(plain.width).toBe(passageSizes.small.width);

		const [previewSized] = brokenLinkGhosts(storyOf([start, previewing]));

		expect(previewSized.height).toBe(passageSizes.largeWithPreview.height);
		expect(previewSized.width).toBe(passageSizes.largeWithPreview.width);
	});

	it('does not overlap ghosts with each other or with real passages', () => {
		// Two passages side by side, each wanting two passages that do not exist. Their
		// default rows would land on top of one another without the placed-so-far pass.
		// Every rect spelled out: `fakePassage` randomizes size and position, and this
		// test is about rects not touching.
		const left = fakePassage({
			height: 100,
			left: 0,
			name: 'Left',
			text: scene(['a: Alpha', 'b: Beta']),
			top: 0,
			width: 100
		});
		const right = fakePassage({
			height: 100,
			left: 125,
			name: 'Right',
			text: scene(['c: Gamma', 'd: Delta']),
			top: 0,
			width: 100
		});
		const story = storyOf([left, right]);
		const rects = [...story.passages, ...brokenLinkGhosts(story)];

		for (let i = 0; i < rects.length; i++) {
			for (let j = i + 1; j < rects.length; j++) {
				expect(rectsIntersect(rects[i], rects[j])).toBe(false);
			}
		}
	});

	// The player resolves a link target case-insensitively (`matchPassageName`, and
	// `passageNamed()` in the format), so `on: street` IS a way into `Street`. Drawing a
	// ghost for it would offer to create a room the story already has.
	it('draws no ghost for a target that differs only in case', () => {
		const start = fakePassage({name: 'Start', text: scene(['on: street'])});
		const street = fakePassage({name: 'Street', text: 'Prose.'});

		expect(brokenLinkGhosts(storyOf([start, street]))).toEqual([]);
	});

	it('draws one ghost when two passages want the same name in different cases', () => {
		const one = fakePassage({name: 'One', text: scene(['on: Cellar'])});
		const two = fakePassage({name: 'Two', text: scene(['on: cellar'])});
		const ghosts = brokenLinkGhosts(storyOf([one, two]));

		expect(ghosts).toHaveLength(1);
		expect(ghosts[0].name).toBe('Cellar');
	});
});
