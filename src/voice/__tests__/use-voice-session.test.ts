import {parseToolLine, summariseResult} from '../use-voice-session';

describe('parseToolLine', () => {
	it('takes a bare tool name', () => {
		expect(parseToolLine('map')).toEqual({args: {}, name: 'map'});
	});

	it('takes JSON arguments', () => {
		expect(parseToolLine('goto {"ref": "Tavern Night"}')).toEqual({
			args: {ref: 'Tavern Night'},
			name: 'goto'
		});
	});

	it('takes an unquoted single argument, because that is what an author types', () => {
		expect(parseToolLine('read_passage Tavern Night')).toEqual({
			args: {ref: 'Tavern Night'},
			name: 'read_passage'
		});
	});

	it('will not guess when the tool wants more than one argument', () => {
		expect(parseToolLine('rename_passage Tavern Night')).toEqual({
			error: 'arguments must be JSON'
		});
	});

	it('refuses an unknown tool', () => {
		expect(parseToolLine('rm -rf')).toEqual({error: "no tool called 'rm'"});
	});

	it('refuses an empty line', () => {
		expect(parseToolLine('   ')).toEqual({error: 'type a tool name'});
	});

	it('refuses arguments that are not an object', () => {
		expect(parseToolLine('map [1,2]')).toEqual({
			error: 'arguments must be a JSON object'
		});
	});
});

describe('summariseResult', () => {
	it('shows the error when there is one', () => {
		expect(summariseResult('goto', {error: 'no passage', ok: false})).toBe(
			'no passage'
		);
	});

	it('says so when a write changed nothing', () => {
		expect(summariseResult('write_passage', {ok: true, unchanged: true})).toBe(
			'no change'
		);
	});

	it('counts a patch’s changed keys', () => {
		expect(
			summariseResult('patch_scene', {changed: ['bg', 'cast/mara at'], ok: true})
		).toBe('bg, cast/mara at');
	});

	it('never puts the passage text in the row', () => {
		const summary = summariseResult('read_passage', {
			name: 'Tavern',
			ok: true,
			text: 'Sit down.\nAnd stay.'
		});

		expect(summary).toBe('Tavern, 2 lines');
		expect(summary).not.toContain('Sit down.');
	});
});
