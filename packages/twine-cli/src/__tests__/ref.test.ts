/** @jest-environment node */

import {
	parseRef,
	pickAsset,
	pickPassage,
	pickScene,
	pickStory,
	sceneIdOf,
	slug
} from '../ref';
import {CliError, EXIT} from '../types';
import type {Manifest, StoryBody, StoryMeta} from '../types';

function meta(id: string, name: string, rev = 1): StoryMeta {
	return {
		assetBytes: 0,
		assetCount: 0,
		assetRev: 1,
		bytes: 0,
		deleted: false,
		id,
		ifid: 'IFID',
		lastClient: 'test',
		name,
		passageCount: 0,
		rev,
		updatedAt: '2026-08-22T00:00:00.000Z'
	};
}

function body(passages: {id: string; name: string; text?: string}[]): StoryBody {
	return {
		id: 'story-1',
		ifid: 'IFID',
		name: 'Trip to my Desert',
		passages: passages.map(passage => ({
			id: passage.id,
			left: 0,
			name: passage.name,
			tags: [],
			text: passage.text ?? '',
			top: 0
		}))
	};
}

describe('parseRef', () => {
	it('reads a bare story', () => {
		expect(parseRef('ep3')).toEqual({kind: 'story', rev: undefined, story: 'ep3'});
	});

	it('reads a passage', () => {
		expect(parseRef('ep3/Tavern Night')).toEqual({
			kind: 'passage',
			passage: 'Tavern Night',
			rev: undefined,
			story: 'ep3'
		});
	});

	it('reads a scene', () => {
		expect(parseRef('ep3#tavern-night')).toEqual({
			kind: 'scene',
			rev: undefined,
			scene: 'tavern-night',
			story: 'ep3'
		});
	});

	it('reads an asset', () => {
		expect(parseRef('ep3:a_8f21')).toEqual({
			asset: 'a_8f21',
			kind: 'asset',
			story: 'ep3'
		});
	});

	it('reads a rev', () => {
		expect(parseRef('ep3@37')).toEqual({kind: 'story', rev: 37, story: 'ep3'});
	});

	it('keeps a rev on the story half of a longer ref', () => {
		expect(parseRef('ep3@37/Tavern Night')).toEqual({
			kind: 'passage',
			passage: 'Tavern Night',
			rev: 37,
			story: 'ep3'
		});
	});

	it('keeps separators that appear inside a passage name', () => {
		expect(parseRef('ep3/Act 1: the road')).toEqual({
			kind: 'passage',
			passage: 'Act 1: the road',
			rev: undefined,
			story: 'ep3'
		});
	});

	it('refuses a ref with no story', () => {
		expect(() => parseRef('/Tavern Night')).toThrow(CliError);
	});

	it('refuses an empty half', () => {
		expect(() => parseRef('ep3/')).toThrow(CliError);
	});
});

describe('slug', () => {
	it('makes spaces and dashes equivalent', () => {
		expect(slug('Chapter 3')).toBe('chapter-3');
		expect(slug('chapter-3')).toBe('chapter-3');
		expect(slug('  CHAPTER_3 ')).toBe('chapter-3');
	});
});

describe('pickStory', () => {
	const stories = [
		meta('79d06063-0d0d-4cb1', 'Chapter 3'),
		meta('a1b2c3d4-0000-0000', 'Chapter 4'),
		meta('Chapter 3', 'Something Else')
	];

	it('prefers an exact id over an exact name', () => {
		expect(pickStory(stories, 'Chapter 3').name).toBe('Something Else');
	});

	it('finds an exact name', () => {
		expect(pickStory(stories, 'Chapter 4').id).toBe('a1b2c3d4-0000-0000');
	});

	it('finds a slug', () => {
		expect(pickStory(stories, 'chapter-4').id).toBe('a1b2c3d4-0000-0000');
	});

	it('finds an id prefix', () => {
		expect(pickStory(stories, '79d06063').name).toBe('Chapter 3');
	});

	it('refuses to guess between two slugs', () => {
		const twins = [meta('id-1', 'Tavern Night'), meta('id-2', 'tavern night')];

		try {
			pickStory(twins, 'tavern-night');
			throw new Error('expected an ambiguity');
		} catch (error) {
			expect(error).toBeInstanceOf(CliError);
			expect((error as CliError).code).toBe(EXIT.usage);
			expect((error as CliError).message).toContain('id-1');
			expect((error as CliError).message).toContain('id-2');
		}
	});

	it('is not found, not ambiguous, when nothing matches', () => {
		try {
			pickStory(stories, 'nothing');
			throw new Error('expected a miss');
		} catch (error) {
			expect((error as CliError).code).toBe(EXIT.notFound);
		}
	});
});

describe('pickPassage', () => {
	const story = body([
		{id: 'p1', name: 'Tavern Night'},
		{id: 'p2', name: 'Street'},
		{id: 'p3', name: 'street day'}
	]);

	it('takes an exact name first', () => {
		expect(pickPassage(story, 'Street').id).toBe('p2');
	});

	it('falls back to a slug', () => {
		expect(pickPassage(story, 'tavern-night').id).toBe('p1');
	});

	it('falls back to an id prefix', () => {
		expect(pickPassage(story, 'p3').id).toBe('p3');
	});

	it('refuses to guess', () => {
		const twins = body([
			{id: 'p1', name: 'Street Day'},
			{id: 'p2', name: 'street-day'}
		]);

		expect(() => pickPassage(twins, 'street day')).toThrow(/ambiguous/);
	});

	it('is not found when nothing matches', () => {
		try {
			pickPassage(story, 'Nowhere');
			throw new Error('expected a miss');
		} catch (error) {
			expect((error as CliError).code).toBe(EXIT.notFound);
		}
	});
});

describe('sceneIdOf', () => {
	it('reads the id out of a scene block', () => {
		expect(sceneIdOf('prose\n\n[scene]\nid: tavern-night\nbg: tavern/night\n')).toBe(
			'tavern-night'
		);
	});

	it('drops a trailing comment', () => {
		expect(sceneIdOf('[scene]\nid: tavern-night   # unique per story\n')).toBe('tavern-night');
	});

	it('still works while the block below is half typed', () => {
		expect(sceneIdOf('[scene]\nid: tavern-night\ncast:\n  mira: {at:\n')).toBe('tavern-night');
	});

	it('is undefined without a scene block', () => {
		expect(sceneIdOf('just prose\n')).toBeUndefined();
	});

	it('ignores an id outside the block', () => {
		expect(sceneIdOf('id: not-a-scene\n')).toBeUndefined();
	});
});

describe('pickScene', () => {
	const story = body([
		{id: 'p1', name: 'Tavern Night', text: '[scene]\nid: tavern-night\n'},
		{id: 'p2', name: 'Street', text: '[scene]\nid: street-day\n'}
	]);

	it('finds the passage that holds the scene', () => {
		expect(pickScene(story, 'street-day').name).toBe('Street');
	});

	it('refuses to guess between duplicate ids', () => {
		const twins = body([
			{id: 'p1', name: 'A', text: '[scene]\nid: dupe\n'},
			{id: 'p2', name: 'B', text: '[scene]\nid: dupe\n'}
		]);

		expect(() => pickScene(twins, 'dupe')).toThrow(/ambiguous/);
	});

	it('is not found for an unknown scene', () => {
		try {
			pickScene(story, 'nowhere');
			throw new Error('expected a miss');
		} catch (error) {
			expect((error as CliError).code).toBe(EXIT.notFound);
		}
	});
});

describe('pickAsset', () => {
	const manifest: Manifest = {
		assets: [
			{
				bytes: 1,
				h: 2,
				hash: 'h',
				id: 'a_8f21',
				kind: 'bg',
				mime: 'image/webp',
				name: 'tavern/night',
				tags: [],
				w: 1
			},
			{
				bytes: 1,
				h: 2,
				hash: 'h',
				id: 'a_3450',
				kind: 'frame',
				mime: 'image/webp',
				name: 'desert-punk/idle',
				tags: [],
				w: 1
			}
		],
		characters: [],
		missing: [],
		rev: 1,
		version: 1
	};

	it('finds by id', () => {
		expect(pickAsset(manifest, 'a_3450').name).toBe('desert-punk/idle');
	});

	it('finds by manifest name', () => {
		expect(pickAsset(manifest, 'tavern/night').id).toBe('a_8f21');
	});

	it('is not found for an unknown asset', () => {
		try {
			pickAsset(manifest, 'a_0000');
			throw new Error('expected a miss');
		} catch (error) {
			expect((error as CliError).code).toBe(EXIT.notFound);
		}
	});
});
