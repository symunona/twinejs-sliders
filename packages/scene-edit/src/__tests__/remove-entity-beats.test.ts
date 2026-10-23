import {parseScene} from '@sliders/scene-schema';
import {applyEdit} from '../index';
import {removeEntityBeats} from '../write';

function remove(text: string, ids: string[]) {
	const edit = removeEntityBeats(text, ids);

	return edit ? applyEdit(text, edit) : undefined;
}

const SCENE = [
	'cast:',
	'  mira: {at: -0.4}',
	'  joren: {at: 0.4}',
	'beats:',
	'  - mira: "Hi."  # greeting',
	'  - joren: "Hey."',
	'  - mira: {at: 0.3, dur: 2}',
	'    joren: {at: -0.3}',
	'  - joren: {pose: wave}',
	'    mira: "Now!"',
	'  - mira: "Bye."',
	'    sfx: door',
	'  - mira: {say: "Go.", if: ready}',
	'    dur: 1',
	'  - wait: 1',
	'    mira: {at: 0}',
	'  - {mira: "a", joren: "b"}',
	''
].join('\n');

describe('removeEntityBeats', () => {
	const out = remove(SCENE, ['mira'])!;

	it('drops beats that were only the entity, keeps everybody else', () => {
		expect(out).toBe(
			[
				'cast:',
				'  mira: {at: -0.4}',
				'  joren: {at: 0.4}',
				'beats:',
				'  - joren: "Hey."',
				'  - joren: {at: -0.3}',
				'  - joren: {pose: wave}',
				'  - sfx: door',
				'  - wait: 1',
				'  - {joren: "b"}',
				''
			].join('\n')
		);
	});

	it('leaves beats the parser reads without errors', () => {
		const result = parseScene(out.replace('  mira: {at: -0.4}\n', ''));

		expect(result.errors.filter(e => e.severity !== 'warning')).toEqual([]);
		expect(result.scene.beats).toHaveLength(6);
	});

	it('removes several ids at once, down to an empty beats list', () => {
		const text = ['beats:', '  - mira: "a"', '  - joren: "b"', ''].join('\n');

		expect(remove(text, ['mira', 'joren'])).toBe('beats:\n');
	});

	it('is a no-op for an entity with no beats', () => {
		expect(remove(SCENE, ['nobody'])).toBeUndefined();
	});
});
