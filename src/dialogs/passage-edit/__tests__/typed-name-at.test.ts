import {typedNameAt} from '../use-scene-hints';

/** `|` = where the closing space / newline / colon went in. */
function at(passage: string) {
	const lines = passage.split('\n');
	const line = lines.findIndex(one => one.includes('|'));
	const ch = lines[line].indexOf('|');

	lines[line] = lines[line].replace('|', '');

	return typedNameAt(lines.join('\n'), {ch, line});
}

describe('typedNameAt()', () => {
	it('bg value, before a space or at line end', () => {
		expect(at('[scene]\nbg: b3| ')).toEqual({kind: 'bg', name: 'b3'});
		expect(at('[scene]\nbg: b3|\n')).toEqual({kind: 'bg', name: 'b3'});
	});

	it('a beat backdrop cut is a bg too', () => {
		expect(at('[scene]\nbeats:\n  - bg: b3|')).toEqual({kind: 'bg', name: 'b3'});
	});

	it('props id and ref: object', () => {
		expect(at('[scene]\nprops:\n  lamp|:')).toEqual({
			kind: 'object',
			name: 'lamp'
		});
		expect(at('[scene]\nprops:\n  l: {ref: lamp| }')).toEqual({
			kind: 'object',
			name: 'lamp'
		});
	});

	it('cast id and entities id: character', () => {
		expect(at('[scene]\ncast:\n  mira|:')).toEqual({
			kind: 'character',
			name: 'mira'
		});
		expect(at('[scene]\nentities:\n  mira|:')).toEqual({
			kind: 'character',
			name: 'mira'
		});
	});

	it('nothing mid-name, in other slots, or outside a scene', () => {
		expect(at('[scene]\nbg: b|3')).toBeUndefined();
		expect(at('[scene]\nprops:\n  l: {fit: cover| }')).toBeUndefined();
		expect(at('just prose b3| ')).toBeUndefined();
	});
});
