import {
	clearSceneTrail,
	hopInto,
	popSceneHop,
	pushSceneHop
} from '../scene-trail';

const hop = (fromId: string, toId: string, fromState = 3) => ({
	fromId,
	fromName: fromId.toUpperCase(),
	fromState,
	toId
});

describe('scene trail', () => {
	beforeEach(clearSceneTrail);

	it('knows the hop that brought the preview to a passage', () => {
		pushSceneHop(hop('a', 'b'));
		expect(hopInto('b')).toEqual(hop('a', 'b'));
	});

	it('has no hop for a passage reached some other way', () => {
		pushSceneHop(hop('a', 'b'));
		expect(hopInto('c')).toBeUndefined();
		expect(popSceneHop('c')).toBeUndefined();
		expect(hopInto('b')).toEqual(hop('a', 'b'));
	});

	it('walks a chain of hops back in order', () => {
		pushSceneHop(hop('a', 'b', 2));
		pushSceneHop(hop('b', 'c', 5));
		expect(popSceneHop('c')).toEqual(hop('b', 'c', 5));
		expect(popSceneHop('b')).toEqual(hop('a', 'b', 2));
		expect(popSceneHop('a')).toBeUndefined();
	});

	it('walks a loop back the way it came', () => {
		pushSceneHop(hop('a', 'b'));
		pushSceneHop(hop('b', 'a'));
		expect(popSceneHop('a')?.fromId).toBe('b');
		expect(popSceneHop('b')?.fromId).toBe('a');
	});

	it('has nothing for no passage', () => {
		pushSceneHop(hop('a', 'b'));
		expect(hopInto(undefined)).toBeUndefined();
	});
});
