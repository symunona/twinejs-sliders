/**
 * The `if:` condition language — what a link, an entity or a beat may test.
 *
 * A small grammar of its own, NOT JavaScript. The player evaluates conditions while a
 * passage renders, and `eval` there would hand every story the page. It is also the only
 * way the editor, `twine-cli` and the player can agree on what a condition means: they all
 * parse it here.
 *
 *   has_key                     truthy
 *   not has_key   /  !has_key   negation (in YAML, quote a leading `!`: "!has_key")
 *   a and b       /  a && b
 *   a or b        /  a || b
 *   coins >= 3                  == != < <= > >=
 *   door == "open"              strings in either quote
 *   passage.visits == 1         dotted names reach Chapbook's lookups
 *   (a or b) and not c
 *
 * A bare name is exactly what `if:` meant before this grammar existed, so every old
 * condition still means the same thing.
 */

export type Condition =
	| {kind: 'name'; name: string; index: number}
	| {kind: 'literal'; value: string | number | boolean | null}
	| {kind: 'not'; arg: Condition}
	| {kind: 'and' | 'or'; left: Condition; right: Condition}
	| {kind: 'compare'; op: CompareOp; left: Condition; right: Condition};

export type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=';

export interface ConditionError {
	message: string;
	hint?: string;
	/** 0-based offset into the condition text. */
	index: number;
}

export type ConditionParse =
	| {condition: Condition; error?: undefined}
	| {condition?: undefined; error: ConditionError};

type Token =
	| {type: 'name'; value: string; index: number}
	| {type: 'number'; value: number; index: number}
	| {type: 'string'; value: string; index: number}
	| {type: 'op'; value: string; index: number}
	| {type: 'end'; index: number};

const WORDS: Record<string, string> = {and: '&&', not: '!', or: '||'};
const LITERALS: Record<string, boolean | null> = {false: false, null: null, true: true};
const OPS = ['==', '!=', '<=', '>=', '&&', '||', '<', '>', '!', '(', ')'];

class Fail extends Error {
	constructor(readonly detail: ConditionError) {
		super(detail.message);
	}
}

function tokenize(text: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;

	while (i < text.length) {
		const char = text[i];

		if (/\s/.test(char)) {
			i++;
			continue;
		}

		if (char === '$') {
			// Harlowe and SugarCube habit, and the first thing a model reaches for. One
			// spelling: Chapbook's vars section names a variable bare, so a condition does.
			throw new Fail({
				hint: `Write '${text.slice(i + 1).match(/^[\w.]*/)![0] || 'name'}', without the $.`,
				index: i,
				message: 'Conditions name variables without a $.'
			});
		}

		if (char === '"' || char === "'") {
			const end = text.indexOf(char, i + 1);

			if (end === -1) {
				throw new Fail({index: i, message: 'This string has no closing quote.'});
			}

			tokens.push({index: i, type: 'string', value: text.slice(i + 1, end)});
			i = end + 1;
			continue;
		}

		const number = /^-?\d+(\.\d+)?/.exec(text.slice(i));

		if (number && (char !== '-' || tokens.length === 0 || tokens[tokens.length - 1].type === 'op')) {
			tokens.push({index: i, type: 'number', value: Number(number[0])});
			i += number[0].length;
			continue;
		}

		const name = /^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*/.exec(text.slice(i));

		if (name) {
			const word = name[0];

			if (word in WORDS) {
				tokens.push({index: i, type: 'op', value: WORDS[word]});
			} else {
				tokens.push({index: i, type: 'name', value: word});
			}

			i += word.length;
			continue;
		}

		const op = OPS.find(candidate => text.startsWith(candidate, i));

		if (op) {
			tokens.push({index: i, type: 'op', value: op});
			i += op.length;
			continue;
		}

		if (char === '=') {
			throw new Fail({
				hint: 'Compare with ==. A condition cannot set anything.',
				index: i,
				message: "A single '=' is not a comparison."
			});
		}

		throw new Fail({index: i, message: `Unexpected '${char}' in a condition.`});
	}

	tokens.push({index: text.length, type: 'end'});
	return tokens;
}

class Parser {
	private at = 0;

	constructor(private readonly tokens: Token[]) {}

	parse(): Condition {
		const condition = this.or();
		const next = this.peek();

		if (next.type !== 'end') {
			throw new Fail({
				hint: 'Join two tests with and / or.',
				index: next.index,
				message: 'The condition goes on after it has finished.'
			});
		}

		return condition;
	}

	private peek(): Token {
		return this.tokens[this.at];
	}

	private isOp(value: string): boolean {
		const token = this.peek();

		return token.type === 'op' && token.value === value;
	}

	private or(): Condition {
		let left = this.and();

		while (this.isOp('||')) {
			this.at++;
			left = {kind: 'or', left, right: this.and()};
		}

		return left;
	}

	private and(): Condition {
		let left = this.not();

		while (this.isOp('&&')) {
			this.at++;
			left = {kind: 'and', left, right: this.not()};
		}

		return left;
	}

	private not(): Condition {
		if (this.isOp('!')) {
			this.at++;
			return {arg: this.not(), kind: 'not'};
		}

		return this.compare();
	}

	private compare(): Condition {
		const left = this.primary();
		const token = this.peek();

		if (
			token.type === 'op' &&
			['==', '!=', '<', '<=', '>', '>='].includes(token.value)
		) {
			this.at++;
			return {kind: 'compare', left, op: token.value as CompareOp, right: this.primary()};
		}

		return left;
	}

	private primary(): Condition {
		const token = this.peek();

		switch (token.type) {
			case 'name':
				this.at++;
				return token.value in LITERALS
					? {kind: 'literal', value: LITERALS[token.value]}
					: {index: token.index, kind: 'name', name: token.value};

			case 'number':
			case 'string':
				this.at++;
				return {kind: 'literal', value: token.value};

			case 'op':
				if (token.value === '(') {
					this.at++;

					const inner = this.or();

					if (!this.isOp(')')) {
						throw new Fail({
							index: this.peek().index,
							message: "Missing ')'."
						});
					}

					this.at++;
					return inner;
				}

				throw new Fail({
					index: token.index,
					message: `Expected a name or a value, found '${token.value}'.`
				});

			case 'end':
				throw new Fail({
					index: token.index,
					message:
						this.at === 0
							? 'The condition is empty.'
							: 'The condition stops before it is finished.'
				});
		}
	}
}

/** Parse a condition. Never throws. */
export function parseCondition(text: string): ConditionParse {
	try {
		return {condition: new Parser(tokenize(text)).parse()};
	} catch (error) {
		if (error instanceof Fail) {
			return {error: error.detail};
		}

		throw error;
	}
}

/** Every variable a condition reads, in the order written. Empty when it does not parse. */
export function conditionNames(text: string): {name: string; index: number}[] {
	const {condition} = parseCondition(text);
	const names: {name: string; index: number}[] = [];

	function walk(node: Condition): void {
		switch (node.kind) {
			case 'name':
				names.push({index: node.index, name: node.name});
				break;
			case 'not':
				walk(node.arg);
				break;
			case 'and':
			case 'or':
			case 'compare':
				walk(node.left);
				walk(node.right);
				break;
		}
	}

	if (condition) {
		walk(condition);
	}

	return names.sort((a, b) => a.index - b.index);
}

function value(node: Condition, lookup: (name: string) => unknown): unknown {
	switch (node.kind) {
		case 'name':
			return lookup(node.name);
		case 'literal':
			return node.value;
		case 'not':
			return !value(node.arg, lookup);
		case 'and':
			return Boolean(value(node.left, lookup)) && Boolean(value(node.right, lookup));
		case 'or':
			return Boolean(value(node.left, lookup)) || Boolean(value(node.right, lookup));
		case 'compare': {
			const left = value(node.left, lookup) as never;
			const right = value(node.right, lookup) as never;

			switch (node.op) {
				// Strict, so `coins == "3"` is false: Chapbook variables keep their JS type,
				// and loose equality's coercions are a trap nobody writes on purpose.
				case '==':
					return left === right;
				case '!=':
					return left !== right;
				case '<':
					return left < right;
				case '<=':
					return left <= right;
				case '>':
					return left > right;
				case '>=':
					return left >= right;
			}
		}
	}
}

/**
 * Evaluate a condition against story state. A condition that does not parse is FALSE —
 * the gated thing stays hidden, and the parser has already told the author why.
 */
export function evalCondition(
	text: string,
	lookup: (name: string) => unknown
): boolean {
	const {condition} = parseCondition(text);

	return condition ? Boolean(value(condition, lookup)) : false;
}
