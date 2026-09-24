/**
 * The `if:` grammar. A bare name must keep meaning exactly what it meant before the
 * grammar existed — every story written so far has only bare names in it.
 */

import {conditionNames, evalCondition, parseCondition} from '../condition';

function holds(text: string, vars: Record<string, unknown> = {}) {
	return evalCondition(text, name => vars[name]);
}

describe('evalCondition()', () => {
	it('reads a bare name as truthy, the way if: always has', () => {
		expect(holds('has_key', {has_key: true})).toBe(true);
		expect(holds('has_key', {has_key: 0})).toBe(false);
		expect(holds('has_key')).toBe(false);
	});

	it('negates with not and !', () => {
		expect(holds('not has_key')).toBe(true);
		expect(holds('!has_key')).toBe(true);
		expect(holds('!!has_key', {has_key: 'yes'})).toBe(true);
	});

	it('joins with and / or, and with && / ||', () => {
		const vars = {a: true, b: false};

		expect(holds('a and b', vars)).toBe(false);
		expect(holds('a or b', vars)).toBe(true);
		expect(holds('a && !b', vars)).toBe(true);
		expect(holds('b || b', vars)).toBe(false);
	});

	it('binds and tighter than or, and not tighter than both', () => {
		expect(holds('a or b and c', {a: true})).toBe(true);
		expect(holds('(a or b) and c', {a: true})).toBe(false);
		expect(holds('not a and b', {b: true})).toBe(true);
	});

	it('compares numbers and strings, strictly', () => {
		const vars = {coins: 3, door: 'open'};

		expect(holds('coins >= 3', vars)).toBe(true);
		expect(holds('coins > 3', vars)).toBe(false);
		expect(holds('coins == "3"', vars)).toBe(false);
		expect(holds("door == 'open'", vars)).toBe(true);
		expect(holds('door != "shut"', vars)).toBe(true);
		expect(holds('coins > -1', vars)).toBe(true);
	});

	it('knows true, false and null', () => {
		expect(holds('flag == true', {flag: true})).toBe(true);
		expect(holds('missing == null', {missing: null})).toBe(true);
	});

	it('hands a dotted name to the lookup whole', () => {
		expect(holds('passage.visits == 1', {'passage.visits': 1})).toBe(true);
	});

	it('is false when it does not parse', () => {
		expect(holds('a and', {a: true})).toBe(false);
	});
});

describe('parseCondition()', () => {
	it.each([
		['', 'The condition is empty.'],
		['a and', 'The condition stops before it is finished.'],
		['(a or b', "Missing ')'."],
		['a b', 'The condition goes on after it has finished.'],
		['"open', 'This string has no closing quote.'],
		['a = 1', "A single '=' is not a comparison."],
		['a ? b : c', "Unexpected '?' in a condition."]
	])('rejects %j', (text, message) => {
		expect(parseCondition(text).error?.message).toBe(message);
	});

	it('refuses a $ and says what to write instead', () => {
		const {error} = parseCondition('!$visited_service_landing');

		expect(error?.message).toBe('Conditions name variables without a $.');
		expect(error?.hint).toBe("Write 'visited_service_landing', without the $.");
		expect(error?.index).toBe(1);
	});
});

describe('conditionNames()', () => {
	it('lists the names read, not the words or the strings', () => {
		expect(conditionNames("not a and door == 'b' or c.d > 2")).toEqual([
			{index: 4, name: 'a'},
			{index: 10, name: 'door'},
			{index: 25, name: 'c.d'}
		]);
	});

	it('is empty for a condition that does not parse', () => {
		expect(conditionNames('a and')).toEqual([]);
	});
});
