import {parseSceneText} from '../use-scene-parse';
import {
	conditionNames,
	definedVariables,
	passageVariables
} from '../validate-vars';

const passages = [
	{
		name: 'Start',
		text: 'has_weapon: false\ncoins: 3\n--\nYou wake up.\n'
	},
	{name: 'Street', text: 'Just prose, no vars here.\n'}
];

/** Every unknown-variable error the parse of `text` produces. */
function unknown(text: string, names = passages) {
	return parseSceneText(text, names).errors.filter(
		error => error.code === 'unknown-variable'
	);
}

describe('passageVariables()', () => {
	it('reads the names above a -- line', () => {
		expect(passageVariables('a: 1\nb: 2\n--\nProse.\n')).toEqual(['a', 'b']);
	});

	it('reads a dotted name and a conditional one', () => {
		expect(
			passageVariables('sliders.fullScreen: false\nseen (visits > 1): true\n--\n')
		).toEqual(['sliders.fullScreen', 'seen']);
	});

	it('finds nothing in a passage that opens with prose', () => {
		expect(passageVariables('Hello there.\n--\nnot: a vars section\n')).toEqual(
			[]
		);
	});

	it('finds nothing in a passage with no -- line', () => {
		expect(passageVariables('bg: tavern\ncast:\n')).toEqual([]);
	});

	it('records a dotted name by its root as well', () => {
		expect([...definedVariables(['player.name: "Mira"\n--\n'])].sort()).toEqual(
			['player', 'player.name']
		);
	});
});

describe('conditionNames()', () => {
	it('reads a bare name', () => {
		expect(conditionNames('has_weapon')).toEqual([
			{index: 0, name: 'has_weapon'}
		]);
	});

	it('skips keywords, numbers and strings', () => {
		expect(conditionNames("coins > 3 and name != 'true'").map(one => one.name)).toEqual([
			'coins',
			'name'
		]);
	});

	it('keeps a dotted path whole', () => {
		expect(conditionNames('player.gear.sword').map(one => one.name)).toEqual([
			'player.gear.sword'
		]);
	});
});

describe('unknownVariableErrors()', () => {
	it('accepts a variable a vars section sets', () => {
		expect(
			unknown('[scene]\nlinks:\n  stay: {to: Street, if: has_weapon}\n')
		).toEqual([]);
	});

	it('accepts a variable this passage sets while it is being typed', () => {
		expect(
			unknown(
				'local_flag: true\n--\n[scene]\nlinks:\n  stay: {to: Street, if: local_flag}\n'
			)
		).toEqual([]);
	});

	it('reports a variable nothing sets, and underlines just the name', () => {
		const errors = unknown('[scene]\nlinks:\n  stay: {to: Street, if: no_such}\n');

		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({
			code: 'unknown-variable',
			line: 3,
			severity: 'error'
		});
		expect(errors[0].message).toContain('no_such');

		// Column span covers `no_such` and nothing else.
		const line = '  stay: {to: Street, if: no_such}';

		expect(line.slice(errors[0].col - 1, errors[0].endCol! - 1)).toBe('no_such');
	});

	it('suggests a near miss', () => {
		const errors = unknown('[scene]\nlinks:\n  stay: {to: Street, if: has_weapo}\n');

		expect(errors[0].hint).toContain('has_weapon');
	});

	it('reports each unset name in an expression', () => {
		const errors = unknown(
			'[scene]\nlinks:\n  stay: {to: Street, if: "coins > 3 and no_such"}\n'
		);

		expect(errors.map(one => one.message.match(/'(\w+)'\.$/)![1])).toEqual([
			'no_such'
		]);
	});

	it('leaves Chapbook built-in namespaces alone', () => {
		expect(
			unknown('[scene]\nlinks:\n  stay: {to: Street, if: passage.visits}\n')
		).toEqual([]);
	});

	it('says nothing when no link has an if:', () => {
		expect(unknown('[scene]\nlinks:\n  stay: {to: Street}\n')).toEqual([]);
	});
});

describe('varsSeparatorErrors()', () => {
	/** Every vars-separator warning the parse of `text` produces. */
	function separator(text: string) {
		return parseSceneText(text, passages).errors.filter(
			one => one.code === 'vars-separator'
		);
	}

	const scene = '[scene]\nid: tavern\n';

	it('warns about three dashes and offers to rewrite the line', () => {
		const errors = separator(`sliders.autoAdvance: 0\n---\n${scene}`);

		expect(errors).toHaveLength(1);
		expect(errors[0].severity).toBe('warning');
		expect(errors[0].line).toBe(2);
		expect(errors[0].fix).toMatchObject({
			line: 2,
			col: 1,
			endCol: 4,
			replaces: '---',
			text: '--'
		});
	});

	it('says nothing when the separator is right', () => {
		expect(separator(`sliders.autoAdvance: 0\n--\n${scene}`)).toEqual([]);
	});

	it('says nothing about trailing whitespace, which the player accepts', () => {
		expect(separator(`sliders.autoAdvance: 0\n-- \n${scene}`)).toEqual([]);
	});

	it('leaves a horizontal rule in prose alone', () => {
		expect(separator(`Chapter one.\n\n---\n\n${scene}`)).toEqual([]);
	});

	it('warns even when there is no scene block to parse', () => {
		// The lines are the passage's own, and a broken vars section is often why the
		// scene below it never parsed.
		expect(separator('a: 1\n---\nJust prose.')).toHaveLength(1);
	});

	it('stops counting variables the player would not set', () => {
		// The knock-on, and the point: with `---` the player sets nothing, so an `if:` on
		// one of those names is genuinely unknown. The separator warning sits beside it.
		const text = `armed: true\n---\n[scene]\nid: a\nlinks:\n  go: {to: Street, if: armed}\n`;

		expect(unknown(text)).toHaveLength(1);
		expect(separator(text)).toHaveLength(1);
	});
});
