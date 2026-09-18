import {
	scanVars,
	storyBubbleDefaults,
	varValue,
	writeStoryBubbleVars
} from '../story-bubble';

const passage = (text: string) => [{name: 'Start', text}];

describe('scanVars', () => {
	it('reads the lines above the separator and nothing below it', () => {
		const vars = scanVars(
			passage("sliders.bubble.as: 'comic'\nmood: 'grim'\n--\nnot: a var\n")
		);

		expect(vars['sliders.bubble.as']).toBe("'comic'");
		expect(vars.mood).toBe("'grim'");
		expect(vars.not).toBeUndefined();
	});

	// The rule the whole vars section hangs off: `---` is a Markdown rule, not a separator.
	it('finds nothing when the separator is a near miss', () => {
		expect(scanVars(passage("sliders.bubble.as: 'comic'\n---\nbody"))).toEqual(
			{}
		);
	});
});

describe('varValue', () => {
	it('unquotes, numbers and passes the rest through', () => {
		expect(varValue("'Bangers, cursive'")).toBe('Bangers, cursive');
		expect(varValue('"comic"')).toBe('comic');
		expect(varValue('0.45')).toBe(0.45);
		expect(varValue('Bangers')).toBe('Bangers');
		expect(varValue('  ')).toBeUndefined();
		expect(varValue(undefined)).toBeUndefined();
	});
});

describe('storyBubbleDefaults', () => {
	it('collects only the bubble variables', () => {
		const style = storyBubbleDefaults(
			passage(
				"sliders.bubble.as: 'comic'\n" +
					"sliders.bubble.font: 'Bangers, cursive'\n" +
					'sliders.bubble.w: 0.42\n' +
					'sliders.autoAdvance: 0\n' +
					'--\n'
			)
		);

		expect(style).toEqual({
			as: 'comic',
			font: 'Bangers, cursive',
			w: 0.42
		});
	});

	it('is nothing when the story declares none', () => {
		expect(storyBubbleDefaults(passage('mood: 1\n--\n'))).toBeUndefined();
		expect(storyBubbleDefaults([])).toBeUndefined();
	});

	// A wrong shape is a typo, and guessing what it meant paints a bubble nobody chose.
	it('drops a value that is not the right kind', () => {
		expect(
			storyBubbleDefaults(passage("sliders.bubble.size: 'big'\n--\n"))
		).toBeUndefined();
	});
});

describe('writeStoryBubbleVars', () => {
	it('adds a section to a passage that has none', () => {
		const text = writeStoryBubbleVars('Once upon a time.', {as: 'comic'});

		expect(text).toBe('sliders.bubble.as: "comic"\n--\nOnce upon a time.');
	});

	it('keeps every variable that is not ours', () => {
		const text = writeStoryBubbleVars(
			"mood: 'grim'\nsliders.autoAdvance: 0\n--\nBody.",
			{sizing: 'absolute'}
		);

		expect(text).toBe(
			"mood: 'grim'\n" +
				'sliders.autoAdvance: 0\n' +
				'sliders.bubble.sizing: "absolute"\n' +
				'--\n' +
				'Body.'
		);
	});

	it('replaces what it wrote last time rather than stacking', () => {
		const once = writeStoryBubbleVars('Body.', {as: 'comic'});
		const twice = writeStoryBubbleVars(once, {as: 'thought'});

		expect(twice).toBe('sliders.bubble.as: "thought"\n--\nBody.');
	});

	// An absent variable is how "no default" is spelled; an empty one sets it to nothing.
	it('removes a key the style no longer carries', () => {
		const once = writeStoryBubbleVars('Body.', {as: 'comic', font: 'Bangers'});
		const twice = writeStoryBubbleVars(once, {as: 'comic'});

		expect(twice).toBe('sliders.bubble.as: "comic"\n--\nBody.');
	});

	it('takes the separator away with the last variable', () => {
		const once = writeStoryBubbleVars('Body.', {as: 'comic'});

		expect(writeStoryBubbleVars(once, undefined)).toBe('Body.');
	});

	it('round trips through the reader', () => {
		const text = writeStoryBubbleVars('Body.', {
			as: 'shard',
			font: 'Bangers, cursive',
			sizing: 'absolute',
			w: 0.5
		});

		expect(storyBubbleDefaults([{name: 'Start', text}])).toEqual({
			as: 'shard',
			font: 'Bangers, cursive',
			sizing: 'absolute',
			w: 0.5
		});
	});
});
