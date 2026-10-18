import {parseScene} from '@sliders/scene-schema';
import {applyEdit} from '../index';
import {setBeatSpeaker} from '../write';

function write(text: string, beat: number, who: string) {
	const edit = setBeatSpeaker(text, beat, who);

	return edit ? applyEdit(text, edit) : undefined;
}

/** What the parser makes of one beat, plus every error and warning. */
function read(text: string, beat: number) {
	const result = parseScene(text);

	return {
		beat: result.scene.beats[beat],
		errors: result.errors.map(error => error.message)
	};
}

const SCENE = [
	'cast:',
	'  bob: {at: -0.4}',
	'  mira: {at: 0.4}',
	'beats:',
	'  - bob: "Hi there."  # greeting',
	"  - bob: {say: 'Sit down.', pose: angry, dur: 2, bubble: {as: yell}}",
	'  - box: Night falls.',
	'  - box: {text: "The end.", as: narrator, dur: 1}',
	'  - mira:',
	'      at: 0.2',
	'      say: Over here.',
	'      link: Cellar',
	'  - bob: {at: 0.1}',
	'  - wait: 1',
	''
].join('\n');

describe('setBeatSpeaker', () => {
	it('renames the speaker of a short line, words and comment kept', () => {
		const out = write(SCENE, 0, 'mira')!;

		expect(out).toContain('  - mira: "Hi there."  # greeting\n');
		expect(read(out, 0)).toEqual({
			beat: expect.objectContaining({
				kind: 'say',
				text: 'Hi there.',
				who: 'mira'
			}),
			errors: []
		});
	});

	it('keeps every key of a map line moved to another character', () => {
		const out = write(SCENE, 1, 'mira')!;

		expect(out).toContain(
			"  - mira: {say: 'Sit down.', pose: angry, dur: 2, bubble: {as: yell}}"
		);
	});

	it('a short line to the narrator becomes a short box', () => {
		const out = write(SCENE, 0, 'box')!;

		expect(out).toContain('  - box: "Hi there."  # greeting\n');
		expect(read(out, 0)).toEqual({
			beat: expect.objectContaining({kind: 'box', text: 'Hi there.'}),
			errors: []
		});
	});

	it('to the narrator: say becomes text, staging keys go, timing and style stay', () => {
		const out = write(SCENE, 1, 'box')!;

		expect(out).toContain(
			"  - box: {text: 'Sit down.', dur: 2, bubble: {as: yell}}"
		);
		expect(read(out, 1)).toEqual({
			beat: expect.objectContaining({dur: 2, kind: 'box', text: 'Sit down.'}),
			errors: []
		});
	});

	it('to the narrator from block form drops the staging lines', () => {
		const out = write(SCENE, 4, 'box')!;

		expect(out).toContain(
			'  - box:\n      text: Over here.\n  - bob: {at: 0.1}'
		);
		expect(read(out, 4)).toEqual({
			beat: expect.objectContaining({kind: 'box', text: 'Over here.'}),
			errors: []
		});
	});

	it('drops neighbouring flow pairs together', () => {
		const text = 'beats:\n  - bob: {say: hi, pose: a, at: 0.2}\n';

		expect(write(text, 0, 'box')).toBe('beats:\n  - box: {text: hi}\n');
	});

	it('narration to a character: text becomes say, everything else stays', () => {
		expect(write(SCENE, 2, 'bob')).toContain('  - bob: Night falls.\n');

		const out = write(SCENE, 3, 'mira')!;

		expect(out).toContain('  - mira: {say: "The end.", as: narrator, dur: 1}');
		expect(read(out, 3)).toEqual({
			beat: expect.objectContaining({dur: 1, kind: 'say', who: 'mira'}),
			errors: []
		});
	});

	it('refuses beats with no words, commands, and no change', () => {
		expect(write(SCENE, 5, 'mira')).toBeUndefined();
		expect(write(SCENE, 6, 'mira')).toBeUndefined();
		expect(write(SCENE, 0, 'bob')).toBeUndefined();
		expect(write(SCENE, 0, 'wait')).toBeUndefined();
		expect(write(SCENE, 0, '')).toBeUndefined();
	});

	it('quotes an id YAML would misread', () => {
		expect(write(SCENE, 0, 'old man')).toContain('  - "old man": "Hi there."');
	});
});
