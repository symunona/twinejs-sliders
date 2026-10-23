/**
 * `emit` through the merge: per key over what the entity has, `null` clears.
 */

import {emptyStage} from '@sliders/scene-types';
import {parseScene} from '@sliders/scene-schema';
import {applyScene} from '../apply-scene';
import {runBeats} from '../run-beats';

describe('emit across beats', () => {
	it('merges per key, and emit: ~ clears', () => {
		const {scene, errors} = parseScene(
			[
				'props:',
				"  fire: {at: 0, emit: {rate: 50, color: '#ff0000'}}",
				'beats:',
				'  - fire: {emit: {rate: 0}}',
				'  - wait: 1',
				'  - fire: {emit: ~}'
			].join('\n')
		);

		expect(errors).toEqual([]);

		const start = applyScene(emptyStage(), scene);
		const states = runBeats(start, scene.beats);

		expect(states.map(state => state.entities.fire.emit)).toEqual([
			{color: '#ff0000', rate: 50},
			{color: '#ff0000', rate: 0},
			{color: '#ff0000', rate: 0},
			undefined
		]);
	});
});
