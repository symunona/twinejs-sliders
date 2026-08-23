/** @jest-environment node */

import {hashText, parse, removePassage, splice, stamp, threeWay} from '../passage';
import {CliError} from '../types';
import type {PassageObject, StoryBody} from '../types';

function passage(over: Partial<PassageObject> = {}): PassageObject {
	return {
		height: 100,
		id: 'p1',
		left: 275,
		name: 'Tavern Night',
		selected: false,
		tags: ['night'],
		text: 'mood: tense\n--\n[scene]\nid: tavern-night\n',
		top: 150,
		width: 100,
		...over
	};
}

function story(passages: PassageObject[]): StoryBody {
	return {
		id: '79d06063-0d0d-4cb1-bf6f-d9d61272d41b',
		ifid: 'B361FCBC',
		name: 'Trip to my Desert',
		passages,
		startPassage: 'p1',
		zoom: 1
	};
}

describe('stamp and parse', () => {
	it('round-trips the text byte for byte', () => {
		const texts = [
			'mood: tense\n--\n[scene]\nid: tavern-night\n',
			'no trailing newline',
			'three trailing newlines\n\n\n',
			'',
			'--- a line that looks like front matter\nand more\n',
			'unicode — “quotes” and 日本語\n'
		];

		for (const text of texts) {
			const file = stamp(story([passage({text})]), passage({text}), 42);

			expect(parse(file).text).toBe(text);
		}
	});

	it('carries the receipt fields', () => {
		const p = passage();
		const {receipt} = parse(stamp(story([p]), p, 42));

		expect(receipt.story).toBe('79d06063-0d0d-4cb1-bf6f-d9d61272d41b');
		expect(receipt.passage).toBe('Tavern Night');
		expect(receipt.rev).toBe(42);
		expect(receipt.hash).toBe(hashText(p.text));
		expect(receipt.name).toBe('Tavern Night');
		expect(receipt.tags).toEqual(['night']);
		expect(receipt.at).toEqual([275, 150]);
	});

	it('stores the full sha256, not a prefix', () => {
		const p = passage();

		expect(parse(stamp(story([p]), p, 1)).receipt.hash).toHaveLength(64);
	});

	it('survives a name that would break plain YAML', () => {
		const p = passage({name: 'no: really, "1.0"'});
		const {receipt} = parse(stamp(story([p]), p, 7));

		expect(receipt.passage).toBe('no: really, "1.0"');
		expect(receipt.name).toBe('no: really, "1.0"');
	});

	it('refuses a file with no front matter', () => {
		expect(() => parse('just text\n')).toThrow(CliError);
	});

	it('refuses front matter that never closes', () => {
		expect(() => parse('---\nstory: x\n')).toThrow(CliError);
	});
});

describe('splice', () => {
	const before = story([
		passage({id: 'p1', name: 'Start', text: 'one'}),
		passage({id: 'p2', name: 'Tavern Night', text: 'two'}),
		passage({id: 'p3', name: 'Street', text: 'three'})
	]);

	it('touches exactly one passage and keeps the order', () => {
		const after = splice(before, 'Tavern Night', 'rewritten');

		expect(after.passages.map(p => p.name)).toEqual(['Start', 'Tavern Night', 'Street']);
		expect(after.passages[1].text).toBe('rewritten');
		expect(after.passages[0]).toBe(before.passages[0]);
		expect(after.passages[2]).toBe(before.passages[2]);
	});

	it('leaves the original body alone', () => {
		splice(before, 'Tavern Night', 'rewritten');

		expect(before.passages[1].text).toBe('two');
	});

	it('preserves unknown fields on the passage and on the story', () => {
		const after = splice(before, 'Tavern Night', 'rewritten');

		expect(after.passages[1].height).toBe(100);
		expect(after.passages[1].width).toBe(100);
		expect(after.passages[1].id).toBe('p2');
		expect(after.startPassage).toBe('p1');
		expect(after.zoom).toBe(1);
	});

	it('applies name, tags and at from the front matter', () => {
		const after = splice(before, 'Tavern Night', 'rewritten', {
			at: [10, 20],
			name: 'Tavern Dawn',
			tags: ['dawn', 'quiet']
		});

		expect(after.passages[1].name).toBe('Tavern Dawn');
		expect(after.passages[1].tags).toEqual(['dawn', 'quiet']);
		expect(after.passages[1].left).toBe(10);
		expect(after.passages[1].top).toBe(20);
	});

	it('refuses a passage that is no longer there', () => {
		expect(() => splice(before, 'Gone', 'text')).toThrow(CliError);
	});
});

describe('removePassage', () => {
	it('drops one passage and nothing else', () => {
		const before = story([
			passage({id: 'p1', name: 'Start'}),
			passage({id: 'p2', name: 'Street'})
		]);
		const after = removePassage(before, 'Start');

		expect(after.passages.map(p => p.name)).toEqual(['Street']);
		expect(before.passages).toHaveLength(2);
	});
});

describe('threeWay', () => {
	const original = 'mood: tense\n[scene]\nid: tavern-night\n';
	const receipt = {
		hash: hashText(original),
		passage: 'Tavern Night',
		rev: 42,
		story: '79d06063-0d0d-4cb1-bf6f-d9d61272d41b'
	};

	it('is fresh when the rev has not moved and the passage matches', () => {
		const now = story([
			passage({name: 'Start', text: 'one'}),
			passage({name: 'Tavern Night', text: original})
		]);

		expect(threeWay(now, receipt, 42)).toBe('fresh');
	});

	it('is stale-elsewhere when the rev moved but this passage did not', () => {
		const now = story([
			passage({name: 'Start', text: 'somebody else edited this'}),
			passage({name: 'Tavern Night', text: original})
		]);

		expect(threeWay(now, receipt, 47)).toBe('stale-elsewhere');
	});

	it('is a conflict when this passage changed', () => {
		const now = story([
			passage({name: 'Tavern Night', text: `${original}bg: tavern/dawn\n`})
		]);

		expect(threeWay(now, receipt, 47)).toBe('conflict');
	});

	it('is a conflict when the passage went away', () => {
		expect(threeWay(story([passage({name: 'Start', text: 'one'})]), receipt, 47)).toBe(
			'conflict'
		);
	});
});
