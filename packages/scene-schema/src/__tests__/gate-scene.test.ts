import {gateScene} from '../gate-scene';
import {parseScene} from '../parse-scene';

function gate(text: string, vars: Record<string, boolean> = {}) {
	return gateScene(parseScene(text).scene, condition => Boolean(vars[condition]));
}

const LANDING = `
cast:
  bob: {at: -0.5}
props:
  drone: {at: 0.2, if: first}
beats:
  - bob: "Here."
  - drone: {say: ":-["}
  - drone: {at: [0, 1], dur: 1}
  - bob: {say: "Again.", if: again}
`;

describe('gateScene()', () => {
	it('keeps what holds', () => {
		const scene = gate(LANDING, {first: true});

		expect(Object.keys(scene.entities)).toEqual(['bob', 'drone']);
		expect(scene.beats.map(beat => beat.index)).toEqual([0, 1, 2]);
		expect(scene).not.toHaveProperty('entityIfs');
	});

	it('takes a gated-out entity and its beats off stage, and renumbers', () => {
		const scene = gate(LANDING, {again: true});

		expect(Object.keys(scene.entities)).toEqual(['bob']);
		expect(scene.beats.map(beat => [beat.index, beat.kind])).toEqual([
			[0, 'say'],
			[1, 'say']
		]);
	});

	it('removes rather than drops under from:, so an inherited entity goes too', () => {
		const scene = gate(`
from: landing
props:
  drone: {at: 0.2, if: first}
`);

		expect(scene.entities.drone).toBeNull();
	});

	it('does not touch the scene it was given', () => {
		const parsed = parseScene(LANDING).scene;

		gateScene(parsed, () => false);
		expect(Object.keys(parsed.entities)).toEqual(['bob', 'drone']);
		expect(parsed.beats).toHaveLength(4);
	});
});
