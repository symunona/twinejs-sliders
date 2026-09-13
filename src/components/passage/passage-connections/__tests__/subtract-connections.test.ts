import {fakePassage} from '../../../../test-util';
import {subtractConnections} from '../subtract-connections';

describe('subtractConnections()', () => {
	const a = fakePassage({name: 'a'});
	const b = fakePassage({name: 'b'});
	const c = fakePassage({name: 'c'});

	it('drops a pair another map already holds', () => {
		const result = subtractConnections(new Map([[a, new Set([b])]]), [
			new Map([[a, new Set([b])]])
		]);

		expect(result.size).toBe(0);
	});

	it('keeps the targets of a start passage that the other map does not name', () => {
		const result = subtractConnections(new Map([[a, new Set([b, c])]]), [
			new Map([[a, new Set([b])]])
		]);

		expect(result).toEqual(new Map([[a, new Set([c])]]));
	});

	it('keeps a pair whose start passage is absent from the other map', () => {
		const result = subtractConnections(new Map([[a, new Set([b])]]), [
			new Map([[c, new Set([b])]])
		]);

		expect(result).toEqual(new Map([[a, new Set([b])]]));
	});

	// The link pass is split into draggable and fixed by selection, so a pair can be in
	// either one.
	it('subtracts every map it is given', () => {
		const result = subtractConnections(new Map([[a, new Set([b, c])]]), [
			new Map([[a, new Set([b])]]),
			new Map([[a, new Set([c])]])
		]);

		expect(result.size).toBe(0);
	});

	it('leaves the map it was given alone', () => {
		const connections = new Map([[a, new Set([b])]]);

		subtractConnections(connections, [new Map([[a, new Set([b])]])]);
		expect(connections).toEqual(new Map([[a, new Set([b])]]));
	});
});
