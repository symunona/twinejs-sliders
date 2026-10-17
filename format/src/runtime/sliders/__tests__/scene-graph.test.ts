/**
 * The story index no longer warns the whole story at startup: "Test from here" on one scene
 * opened under every other scene's problems. A scene's own cross-passage problems are
 * handed out per passage instead.
 */

import {crossPassageProblems, initSceneIndex} from '../scene-graph';

const mockPassages = [
	{name: 'Start', source: '[scene]\nbg: hall\nwhat: 1\n'},
	{name: 'Middle', source: '[scene]\nfrom: Phantom\nbg: forest\n'},
	{name: 'End', source: '[scene]\nfrom: Start\n'}
];

jest.mock('../../story', () => ({passages: () => mockPassages}));

describe('initSceneIndex', () => {
	it('puts nothing on console.warn, which the warning list spies on', () => {
		const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
		const info = jest.spyOn(console, 'info').mockImplementation(() => {});

		initSceneIndex();

		expect(warn).not.toHaveBeenCalled();
		expect(info).toHaveBeenCalledTimes(1);
		warn.mockRestore();
		info.mockRestore();
	});
});

describe('crossPassageProblems', () => {
	beforeEach(() => {
		jest.spyOn(console, 'info').mockImplementation(() => {});
		initSceneIndex();
	});

	it("gives a passage its own from: problem and nobody else's", () => {
		expect(crossPassageProblems('Middle')).toEqual([
			expect.stringContaining("Unknown scene 'Phantom'")
		]);
		expect(crossPassageProblems('End')).toEqual([]);
	});

	it('leaves parse errors to the modifier, which reports them as the scene renders', () => {
		expect(crossPassageProblems('Start')).toEqual([]);
	});
});
