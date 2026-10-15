import {parseScene} from '@sliders/scene-schema';
import {applyEdit} from '../index';
import {setBeatText} from '../write';

function write(text: string, beat: number, value: string) {
	const edit = setBeatText(text, beat, value);

	return edit ? applyEdit(text, edit) : undefined;
}

/** What the parser makes of the result: the only thing the author sees. */
function said(text: string, beat = 0) {
	const result = parseScene(text);

	return {
		errors: result.errors.map(error => error.message),
		text: (result.scene.beats[beat] as {text?: string} | undefined)?.text
	};
}

const SCENE = [
	'cast:',
	'  bob: {at: -0.4}',
	'beats:',
	'  - bob: "Hi there."  # greeting',
	"  - bob: {say: 'Sit down.', dur: 2, bubble: {as: yell}}",
	'  - box: Night falls.',
	'  - box: {text: "The end.", as: narrator}',
	'  - bob: |',
	'      Line one.',
	'      Line two.',
	'  - wait: 1',
	''
].join('\n');

describe('setBeatText', () => {
	it('keeps double quotes and the comment on a short dialogue beat', () => {
		const out = write(SCENE, 0, 'Hello, "you".')!;

		expect(out).toContain('  - bob: "Hello, \\"you\\"."  # greeting');
		expect(said(out, 0)).toEqual({errors: [], text: 'Hello, "you".'});
	});

	it('splices only `say:` in the map form, single quotes kept', () => {
		const out = write(SCENE, 1, "Don't.")!;

		expect(out).toContain("  - bob: {say: 'Don''t.', dur: 2, bubble: {as: yell}}");
		expect(said(out, 1)).toEqual({errors: [], text: "Don't."});
	});

	it('writes a plain box bare, and quotes it only when the words need it', () => {
		expect(write(SCENE, 2, 'Dawn.')).toContain('  - box: Dawn.\n');

		const out = write(SCENE, 2, 'Dawn: a, b')!;

		expect(said(out, 2)).toEqual({errors: [], text: 'Dawn: a, b'});
	});

	it('splices `text:` in a box map', () => {
		const out = write(SCENE, 3, 'Fin.')!;

		expect(out).toContain('  - box: {text: "Fin.", as: narrator}');
	});

	it('keeps a block scalar a block, at its old indent', () => {
		const out = write(SCENE, 4, 'One.\nTwo.\nThree.')!;

		expect(out).toContain('  - bob: |-\n      One.\n      Two.\n      Three.\n  - wait: 1');
		expect(said(out, 4)).toEqual({errors: [], text: 'One.\nTwo.\nThree.'});
	});

	it('falls back to double quotes for a newline in a quoted beat', () => {
		const out = write(SCENE, 0, 'A\nB')!;

		expect(said(out, 0)).toEqual({errors: [], text: 'A\nB'});
		expect(said(out, 1).text).toBe('Sit down.');
	});

	it('leaves every other beat alone', () => {
		const out = write(SCENE, 2, 'Dawn.')!;
		const before = parseScene(SCENE).scene.beats;
		const after = parseScene(out).scene.beats;

		expect(after.filter((_, index) => index !== 2)).toEqual(
			before.filter((_, index) => index !== 2)
		);
	});

	it('refuses a beat with no words, and a no-op', () => {
		expect(setBeatText(SCENE, 5, 'x')).toBeUndefined();
		expect(setBeatText(SCENE, 0, 'Hi there.')).toBeUndefined();
	});
});
