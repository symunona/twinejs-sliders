import {passageProse} from '../passage-prose';

describe('passageProse', () => {
	it('leaves a passage with no scene alone', () => {
		expect(passageProse('Just prose.\n\n[[Onward]]')).toBe(
			'Just prose.\n\n[[Onward]]'
		);
	});

	it('cuts the scene block and its modifier line', () => {
		expect(
			passageProse('Before.\n\n[scene]\nbg: hall\ncast:\n  mira: {}\n')
		).toBe('Before.');
	});

	it('keeps what follows the block', () => {
		expect(
			passageProse('Before.\n[scene]\nbg: hall\n[note]\nAfter.')
		).toBe('Before.\n[note]\nAfter.');
	});

	it('is empty for a passage that is nothing but a scene', () => {
		expect(passageProse('[scene]\nbg: hall\n')).toBe('');
	});
});
