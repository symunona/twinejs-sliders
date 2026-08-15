import {parseSceneText} from '../use-scene-parse';

describe('parseSceneText', () => {
	it('reports no scene for a plain passage', () => {
		const result = parseSceneText('Just some ordinary passage text.\n\n[[Onward]]');

		expect(result.hasScene).toBe(false);
		expect(result.errors).toHaveLength(0);
	});

	it('parses a scene block out of a Chapbook passage', () => {
		const result = parseSceneText(
			[
				'mood: tense',
				'--',
				'[scene]',
				'id: tavern-night',
				'bg: tavern-night',
				'cast:',
				'  mira: {at: -0.4, frame: idle}',
				'beats:',
				'  - mira: "Hello."'
			].join('\n')
		);

		expect(result.hasScene).toBe(true);
		expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
		// S0 plus one beat.
		expect(result.states).toHaveLength(2);
		expect(result.states[0].entities.mira).toBeDefined();
		expect(result.states[0].entities.mira.at.x).toBeCloseTo(-0.4);
	});

	it('offsets error line numbers back into passage coordinates', () => {
		// The bad key is on line 5 of the passage, line 3 of the scene block.
		const text = [
			'mood: tense', // 1
			'--', // 2
			'[scene]', // 3
			'id: broken', // 4
			'chast:', // 5
			'  mira: {at: 0}' // 6
		].join('\n');

		const result = parseSceneText(text);
		const unknown = result.errors.find(e => e.code === 'unknown-key');

		expect(unknown).toBeDefined();
		expect(unknown!.line).toBe(5);
		expect(unknown!.hint).toMatch(/cast/);
	});

	it('still returns a renderable stage when the scene has errors', () => {
		const result = parseSceneText(
			['[scene]', 'id: broken', 'cast:', '  mira: {at: 0, layer: middle}'].join('\n')
		);

		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.states.length).toBeGreaterThanOrEqual(1);
		// The preview must never blank out — this is the whole point.
		expect(result.states[0]).toBeDefined();
	});

	it('survives a parser crash without throwing', () => {
		// Deeply malformed YAML must not escape as an exception.
		const result = parseSceneText(
			['[scene]', 'cast:', '  - [unbalanced', '    nonsense: : :'].join('\n')
		);

		expect(result.hasScene).toBe(true);
		expect(result.states.length).toBeGreaterThanOrEqual(1);
	});
});
