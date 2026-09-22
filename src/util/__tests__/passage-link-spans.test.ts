import {passageLinkAt, passageLinkSpans} from '../passage-link-spans';

/** The span covering `needle`, as the scanner should have reported it. */
function spanOf(text: string, needle: string, target: string) {
	const start = text.indexOf(needle);

	expect(start).toBeGreaterThanOrEqual(0);

	return {end: start + needle.length, start, target};
}

describe('passageLinkSpans', () => {
	it('covers the whole tag of a plain wiki link', () => {
		const text = 'Go [[Tavern]] now.';

		expect(passageLinkSpans(text)).toEqual([
			spanOf(text, '[[Tavern]]', 'Tavern')
		]);
	});

	it.each([
		['[[go on->Tavern]]', 'Tavern'],
		['[[Tavern<-go on]]', 'Tavern'],
		['[[go on|Tavern]]', 'Tavern'],
		['[[go on->Tavern][x to 1]]', 'Tavern']
	])('reads the target out of %s', (tag, target) => {
		const text = `Text ${tag} text`;

		expect(passageLinkSpans(text)).toEqual([spanOf(text, tag, target)]);
	});

	it('leaves out links to a web site, which open no passage', () => {
		expect(passageLinkSpans('See [[https://twinery.org]].')).toEqual([]);
	});

	describe('in a scene', () => {
		const text = [
			'Prose with a [[Plain Target]].',
			'',
			'[scene]',
			'bg: tavern',
			'cast:',
			'  door: {frame: idle, link: stay}',
			'links:',
			'  stay: Tavern Fight',
			'  go: {to: Street}  # the long way',
			'',
			'- say: Well? [[stay]] or [[go]]?'
		].join('\n');
		const spans = passageLinkSpans(text);

		it('reads wiki links written above the block', () => {
			expect(spans).toContainEqual(
				spanOf(text, '[[Plain Target]]', 'Plain Target')
			);
		});

		it('resolves a bare [[name]] through the links: block', () => {
			expect(spans).toContainEqual(spanOf(text, '[[stay]]', 'Tavern Fight'));
			expect(spans).toContainEqual(spanOf(text, '[[go]]', 'Street'));
		});

		it('marks the targets in the links: block themselves', () => {
			expect(spans).toContainEqual(
				spanOf(text, 'Tavern Fight', 'Tavern Fight')
			);
			// Offsets stop at the target, not at the comment that follows it.
			expect(spans).toContainEqual(spanOf(text, 'Street', 'Street'));
		});

		it("follows an entity link: naming a links: entry to that entry's target", () => {
			expect(spans).toContainEqual({
				end: text.indexOf('link: stay') + 'link: stay'.length,
				start: text.indexOf('link: stay') + 'link: '.length,
				target: 'Tavern Fight'
			});
		});
	});

	it('reads an entity link: pointing straight at a passage', () => {
		const text = '[scene]\ncast:\n  door:\n    link: Cellar\n';

		expect(passageLinkSpans(text)).toEqual([spanOf(text, 'Cellar', 'Cellar')]);
	});

	it('ignores an unclickable entity link', () => {
		expect(passageLinkSpans('[scene]\ncast:\n  door: {link: ~}\n')).toEqual([]);
	});
});

describe('passageLinkAt', () => {
	const text = 'Go [[Tavern]] now.';

	it('finds the link the offset falls inside', () => {
		expect(passageLinkAt(text, text.indexOf('Tavern'))?.target).toBe('Tavern');
		expect(passageLinkAt(text, text.indexOf('[['))?.target).toBe('Tavern');
	});

	it('returns nothing outside one', () => {
		expect(passageLinkAt(text, 0)).toBeUndefined();
		expect(passageLinkAt(text, text.indexOf('now'))).toBeUndefined();
	});
});
