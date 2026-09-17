import {applyEdit} from '../index';
import {entityHasParent, insertBeatEntity} from '../write';

/** Apply, or report that nothing was written. */
function edit(
	text: string,
	index: number,
	id: string,
	keys: Record<string, unknown>,
	options?: {relative?: boolean}
) {
	const out = insertBeatEntity(text, index, id, keys, options);

	return out ? applyEdit(text, out) : undefined;
}

describe('insertBeatEntity()', () => {
	const text = [
		'cast:',
		'  mira: {at: -0.4}',
		'beats:',
		'  - mira: "Hello."',
		'  - tav: "Hi."'
	].join('\n');

	it('writes a set beat after the item it follows', () => {
		expect(edit(text, 1, 'candle', {at: {x: 0.5, y: -0.85}})).toBe(
			[
				'cast:',
				'  mira: {at: -0.4}',
				'beats:',
				'  - mira: "Hello."',
				'  - candle: {at: 0.5}',
				'  - tav: "Hi."'
			].join('\n')
		);
	});

	it('appends after the last beat', () => {
		expect(edit(text, 2, 'mira', {at: {x: 0.2, y: -0.85}})).toBe(
			[text, '  - mira: {at: 0.2}'].join('\n')
		);
	});

	// One gesture, one beat: `at` and `scale` arrive together and belong on one line, in
	// the schema's own key order whatever order they were handed over in.
	it('takes every key in one item, in schema order', () => {
		expect(
			edit(text, 2, 'mira', {flip: true, scale: 2, at: {x: 0, y: -0.85}})
		).toContain('  - mira: {at: 0, scale: 2, flip: true}');
	});

	// The previous beat's note belongs to the previous beat.
	it('lands after a trailing comment, not inside it', () => {
		const noted = text.replace('  - tav: "Hi."', '  - tav: "Hi." # beat two');

		expect(edit(noted, 2, 'mira', {at: {x: 0.2, y: -0.85}})).toBe(
			[noted, '  - mira: {at: 0.2}'].join('\n')
		);
	});

	it('keeps the file\'s own indent', () => {
		const wide = text.replace(/ {2}- /g, '    - ');

		expect(edit(wide, 2, 'mira', {at: {x: 0.2, y: -0.85}})).toBe(
			[wide, '    - mira: {at: 0.2}'].join('\n')
		);
	});

	// A bare `at` is measured from the layer baseline, unless the entity hangs off a
	// parent — then zero is the parent. Writing it bare either way would move a child a
	// stage-height on the next parse.
	it('measures a child\'s bare `at` from its parent', () => {
		expect(
			edit(text, 2, 'cup', {at: {x: 0.1, y: 0}}, {relative: true})
		).toContain('  - cup: {at: 0.1}');
		expect(edit(text, 2, 'cup', {at: {x: 0.1, y: 0}})).toContain(
			'  - cup: {at: [0.1, 0]}'
		);
	});

	it('refuses to write before the first beat, or with nothing to say', () => {
		expect(edit(text, 0, 'mira', {at: {x: 0, y: 0}})).toBeUndefined();
		expect(edit(text, 2, 'mira', {})).toBeUndefined();
		expect(edit('cast:\n  mira: {at: 0}', 1, 'mira', {scale: 2})).toBeUndefined();
	});
});

describe('entityHasParent()', () => {
	const text = [
		'props:',
		'  table: {at: 0}',
		'  cup: {of: table, at: 0.1}'
	].join('\n');

	it('reads the `of:` off the entity\'s own entry', () => {
		expect(entityHasParent(text, {id: 'cup', kind: 'prop'})).toBe(true);
		expect(entityHasParent(text, {id: 'table', kind: 'prop'})).toBe(false);
		expect(entityHasParent(text, {id: 'gone', kind: 'prop'})).toBe(false);
	});
});
