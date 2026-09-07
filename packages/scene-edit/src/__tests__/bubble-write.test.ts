import {applyEdit, setBeatBubble} from '..';

const edit = (text: string, index: number, geometry: Parameters<typeof setBeatBubble>[2]) => {
	const result = setBeatBubble(text, index, geometry);

	return result ? applyEdit(text, result) : undefined;
};

describe('setBeatBubble', () => {
	it('promotes a bare say beat to map form', () => {
		const text = `beats:\n  - mira: "Get out."\n`;

		expect(edit(text, 0, {at: {x: 0.5, y: 0.25}})).toBe(
			`beats:\n  - mira: {say: "Get out.", bubble: {at: [0.5, 0.25]}}\n`
		);
	});

	it('keeps the original quoting of the line it promotes', () => {
		const text = `beats:\n  - mira: 'she said "no"'\n`;

		expect(edit(text, 0, {w: 0.4})).toBe(
			`beats:\n  - mira: {say: 'she said "no"', bubble: {w: 0.4}}\n`
		);
	});

	it('promotes a bare box beat with text:', () => {
		const text = `beats:\n  - box: "The candle gutters."\n`;

		expect(edit(text, 0, {at: {x: 0.2, y: 0.8}})).toBe(
			`beats:\n  - box: {text: "The candle gutters.", bubble: {at: [0.2, 0.8]}}\n`
		);
	});

	it('adds bubble: to a beat that is already a map', () => {
		const text = `beats:\n  - mira: {say: "Hi", at: -0.4}\n`;

		expect(edit(text, 0, {w: 0.3})).toBe(
			`beats:\n  - mira: {say: "Hi", at: -0.4, bubble: {w: 0.3}}\n`
		);
	});

	it('writes into an existing bubble map without touching its other keys', () => {
		const text = `beats:\n  - mira: {say: "Hi", bubble: {as: yell, w: 0.5}}\n`;

		expect(edit(text, 0, {at: {x: 0.1, y: 0.2}, w: 0.3})).toBe(
			`beats:\n  - mira: {say: "Hi", bubble: {as: yell, w: 0.3, at: [0.1, 0.2]}}\n`
		);
	});

	it('keeps a scalar bubble: token as as:', () => {
		const text = `beats:\n  - mira: {say: "Hi", bubble: yell}\n`;

		expect(edit(text, 0, {w: 0.3})).toBe(
			`beats:\n  - mira: {say: "Hi", bubble: {as: yell, w: 0.3}}\n`
		);
	});

	it('removes a key written as null', () => {
		const text = `beats:\n  - mira: {say: "Hi", bubble: {at: [0.1, 0.2], w: 0.3}}\n`;

		expect(edit(text, 0, {at: null})).toBe(
			`beats:\n  - mira: {say: "Hi", bubble: {w: 0.3}}\n`
		);
	});

	it('leaves comments and block formatting alone', () => {
		const text = [
			'beats:',
			'  - mira:',
			'      say: "Hi" # the first thing she says',
			'      bubble:',
			'        as: yell',
			''
		].join('\n');

		expect(edit(text, 0, {w: 0.25})).toBe(
			[
				'beats:',
				'  - mira:',
				'      say: "Hi" # the first thing she says',
				'      bubble:',
				'        as: yell',
				'        w: 0.25',
				''
			].join('\n')
		);
	});

	it('refuses a command beat', () => {
		expect(setBeatBubble(`beats:\n  - wait: 0.5\n`, 0, {w: 0.3})).toBeUndefined();
	});
});
