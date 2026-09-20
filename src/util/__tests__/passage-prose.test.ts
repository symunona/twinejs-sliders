import {passageProse} from '../passage-prose';

describe('passageProse', () => {
	it('leaves a passage with no scene or vars alone', () => {
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
		expect(passageProse('Before.\n[scene]\nbg: hall\n[note]\nAfter.')).toBe(
			'Before.\n[note]\nAfter.'
		);
	});

	it('is empty for a passage that is nothing but a scene', () => {
		expect(passageProse('[scene]\nbg: hall\n')).toBe('');
	});

	it('cuts the vars section', () => {
		expect(passageProse('mood: "grim"\n--\nShe waits.')).toBe('She waits.');
	});

	it('cuts both a vars section and a scene block', () => {
		expect(
			passageProse(
				'sliders.bubble.as: "shard"\nsliders.bubble.bg: "#251818"\n--\nProtagonist approaching oasis.\n\n[scene]\nbg: oasis\n'
			)
		).toBe('Protagonist approaching oasis.');
	});

	it('is empty for a passage that is nothing but vars and a scene', () => {
		expect(passageProse('mood: "grim"\n--\n[scene]\nbg: hall\n')).toBe('');
	});

	it('keeps the prose below a `--` that the prose itself contains', () => {
		expect(
			passageProse('mood: "grim"\n--\nShe waits.\n--\nThen she goes.')
		).toBe('She waits.\n--\nThen she goes.');
	});

	it('keeps blank lines inside the prose', () => {
		expect(passageProse('mood: "grim"\n--\nOne.\n\nTwo.')).toBe('One.\n\nTwo.');
	});
});
