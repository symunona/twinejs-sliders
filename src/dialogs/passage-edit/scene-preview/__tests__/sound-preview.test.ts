import {previewSounds} from '../sound-preview';

describe('previewSounds', () => {
	it('plays every track in effect, looping only what loops forever', () => {
		expect(
			previewSounds(
				{
					drums: {amount: 0.3, fade: 0, id: 'drums', loop: 3},
					main: {amount: 1, fade: 1.5, id: 'rain', loop: true, start: 2},
					theme: {amount: 1, fade: 1.5, id: 'theme', loop: {from: 4}}
				},
				undefined
			)
		).toEqual([
			{amount: 0.3, id: 'drums', loop: false, start: undefined},
			{amount: 1, id: 'rain', loop: true, start: 2},
			{amount: 1, id: 'theme', loop: true, start: undefined}
		]);
	});

	it("adds the beat's sfx once", () => {
		expect(previewSounds(undefined, {amount: 0.4, id: 'door'})).toEqual([
			{amount: 0.4, id: 'door', loop: false}
		]);
	});

	it('is empty with nothing to hear', () => {
		expect(previewSounds({}, undefined)).toEqual([]);
	});
});
