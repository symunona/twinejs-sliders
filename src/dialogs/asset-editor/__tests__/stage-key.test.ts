import {stageKey} from '../asset-editor';

describe('stageKey', () => {
	it('names the plain stages', () => {
		expect(stageKey({stage: 'download'}, false)).toBe(
			'dialogs.assetEditor.stage.download'
		);
		expect(stageKey({stage: 'refine'}, false)).toBe(
			'dialogs.assetEditor.stage.refine'
		);
	});

	it('tells the two passes apart', () => {
		// Two identical lines in a row read like a hang, which is the whole
		// reason the engine tags the closer pass.
		expect(stageKey({stage: 'run'}, false)).toBe(
			'dialogs.assetEditor.stage.run'
		);
		expect(stageKey({pass: 2, stage: 'run'}, false)).toBe(
			'dialogs.assetEditor.stage.runCloser'
		);
	});

	it('says a percentage is a guess when it is one', () => {
		expect(stageKey({estimated: true, progress: 0.4, stage: 'run'}, true)).toBe(
			'dialogs.assetEditor.stage.runEstimated'
		);
		expect(
			stageKey({estimated: true, pass: 2, progress: 0.4, stage: 'run'}, true)
		).toBe('dialogs.assetEditor.stage.runCloserEstimated');
	});

	it('does not claim the CPU fallback is setting up a GPU', () => {
		expect(stageKey({stage: 'start'}, true)).toBe(
			'dialogs.assetEditor.stage.startCpu'
		);
		expect(stageKey({stage: 'start'}, false)).toBe(
			'dialogs.assetEditor.stage.start'
		);
	});
});
