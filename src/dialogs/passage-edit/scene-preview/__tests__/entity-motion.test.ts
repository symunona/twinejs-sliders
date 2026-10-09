import {parseSceneText} from '../use-scene-parse';
import {isStretched, lockWrites, unstretchWrites} from '../scene-gestures';

/**
 * The new entity keys end to end through parse and beat replay: what each state holds is
 * what the renderer and the overlay get.
 */

const SCENE = [
	'[scene]',
	'props:',
	'  hills: {fit: cover, motion: scroll_infinite_left, z: -2}',
	'  tree: {at: 0.3, stretch: [1.5, 1]}',
	'beats:',
	'  - hills: {opacity: 0.9}',
	'  - hills: {motion: ~}'
].join('\n');

describe('motion: through the beats', () => {
	const {states} = parseSceneText(SCENE);

	it('is inherited by a beat that does not mention it', () => {
		expect(states[1].entities.hills.motion).toEqual({id: 'scroll_infinite_left'});
	});

	it('is stopped by motion: ~', () => {
		expect(states[2].entities.hills.motion).toBeUndefined();
	});
});

describe('stretch and lock writes', () => {
	const stage = parseSceneText(SCENE).states[0];

	it('knows a squeezed entity from one at its own aspect', () => {
		expect(isStretched(stage.entities.tree)).toBe(true);
		expect(isStretched(stage.entities.hills)).toBe(false);
	});

	it('resets only what is squeezed, deleting the key and saying [1, 1] on a beat', () => {
		expect(unstretchWrites(stage, ['tree', 'hills'])).toEqual([
			{id: 'tree', key: 'stretch', kind: 'prop', ref: 'tree', reset: [1, 1], value: undefined}
		]);
	});

	it('locks on the entry, wherever the scrubber is', () => {
		expect(lockWrites(stage, ['tree'])).toEqual([
			{entry: true, id: 'tree', key: 'locked', kind: 'prop', ref: 'tree', value: true}
		]);
	});
});
