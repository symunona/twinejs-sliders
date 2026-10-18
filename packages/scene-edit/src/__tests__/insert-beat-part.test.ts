import {parseScene} from '@sliders/scene-schema';
import {applyEdit, setEntityKey} from '../index';
import {insertBeatPart} from '../write';

const CAST = 'cast:\n  mira: {at: 0}\n  joren: {at: 0.5}\nbeats:\n';

function join(text: string, index: number, id: string, keys: Record<string, unknown>) {
	const edit = insertBeatPart(text, index, id, keys);

	return edit ? applyEdit(text, edit) : undefined;
}

describe('insertBeatPart', () => {
	it('lines the new key up with the beat’s first key', () => {
		const out = join(`${CAST}  - mira: "Look."  # here\n  - wait: 1\n`, 0, 'joren', {
			at: {x: 0.2, y: -0.85}
		});

		expect(out).toBe(
			`${CAST}  - mira: "Look."  # here\n    joren: {at: 0.2}\n  - wait: 1\n`
		);
		expect(parseScene(out!).scene.beats[0].with).toEqual([
			{patch: {at: {x: 0.2, y: -0.85}}, who: 'joren'}
		]);
	});

	it('joins a flow beat inside its braces', () => {
		const out = join(`${CAST}  - {box: "Later.", if: x}\n`, 0, 'mira', {
			at: {x: 0.2, y: -0.85}
		});

		expect(out).toBe(`${CAST}  - {box: "Later.", if: x, mira: {at: 0.2}}\n`);
	});

	it('refuses an entity the beat already names', () => {
		expect(join(`${CAST}  - mira: "x"\n`, 0, 'mira', {at: {x: 0, y: -0.85}})).toBe(
			undefined
		);
	});

	it('a later write finds the joined entity under its own key', () => {
		const text = `${CAST}  - mira: "Look."\n    joren: {at: 0.2}\n`;
		const edit = setEntityKey(text, {beat: 0, id: 'joren', kind: 'cast'}, 'scale', 2);

		expect(applyEdit(text, edit!)).toContain('    joren: {at: 0.2, scale: 2}');
	});
});
