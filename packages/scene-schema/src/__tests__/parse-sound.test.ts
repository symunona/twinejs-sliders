import {parseScene} from '../parse-scene';

describe('music:', () => {
	it('takes a bare name', () => {
		const {scene, errors} = parseScene('music: tavern-loop');

		expect(errors).toEqual([]);
		expect(scene.music).toEqual({amount: 1, id: 'tavern-loop'});
	});

	it('takes the name@volume token fx: already uses', () => {
		const {scene, errors} = parseScene('music: tavern-loop@0.4');

		expect(errors).toEqual([]);
		expect(scene.music).toEqual({amount: 0.4, id: 'tavern-loop'});
	});

	it('takes the long form, spelling the number volume:', () => {
		const {scene, errors} = parseScene('music: {id: rain, volume: 0.25}');

		expect(errors).toEqual([]);
		expect(scene.music).toEqual({amount: 0.25, id: 'rain'});
	});

	it('reads `music: ~` as an explicit silence, not as absence', () => {
		const {scene, errors} = parseScene('music: ~');

		expect(errors).toEqual([]);
		// null, not undefined: under `from:` the two mean opposite things.
		expect(scene.music).toBeNull();
	});

	it('leaves music undefined when the scene never mentions it', () => {
		expect(parseScene('bg: tavern').scene.music).toBeUndefined();
	});

	it('keeps a numeric-looking name as written', () => {
		// The YAML core schema resolves `04` to the number 4, which would address an asset
		// named `4` that nobody has.
		const {scene} = parseScene('music: 04');

		expect(scene.music).toEqual({amount: 1, id: '04'});
	});

	it('rejects a list', () => {
		const {errors} = parseScene('music: [a, b]');

		expect(errors).toHaveLength(1);
		expect(errors[0].message).toMatch(/must be a sound's name/);
	});

	it('names the unknown key it found in the long form', () => {
		const {errors} = parseScene('music: {id: rain, amount: 0.5}');

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('unknown-key');
		// `amount` is fx's word for it; the hint should send the author to `volume`.
		expect(errors[0].hint).toMatch(/volume/);
	});
});

describe('sfx:', () => {
	it('is a beat of its own', () => {
		const {scene, errors} = parseScene(
			['beats:', '  - sfx: door-slam'].join('\n')
		);

		expect(errors).toEqual([]);
		expect(scene.beats).toHaveLength(1);
		expect(scene.beats[0]).toMatchObject({
			kind: 'sfx',
			sfx: {amount: 1, id: 'door-slam'}
		});
	});

	it('takes a volume the same way music does', () => {
		const {scene} = parseScene(['beats:', '  - sfx: door@0.3'].join('\n'));

		expect(scene.beats[0]).toMatchObject({sfx: {amount: 0.3, id: 'door'}});
	});

	it('rides on a spoken line', () => {
		const {scene, errors} = parseScene(
			['beats:', '  - mira: {say: "Oh!", sfx: gasp}'].join('\n')
		);

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toMatchObject({
			kind: 'say',
			sfx: {amount: 1, id: 'gasp'},
			text: 'Oh!',
			who: 'mira'
		});
	});

	it('rides on a stage move', () => {
		const {scene, errors} = parseScene(
			['beats:', '  - mira: {at: 0.3, sfx: step}'].join('\n')
		);

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toMatchObject({
			kind: 'set',
			sfx: {amount: 1, id: 'step'}
		});
	});

	it('rides on a narration box', () => {
		const {scene, errors} = parseScene(
			['beats:', '  - box: {text: "A door.", sfx: creak}'].join('\n')
		);

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toMatchObject({
			kind: 'box',
			sfx: {amount: 1, id: 'creak'}
		});
	});

	it('sends a speaker-only sfx beat to the beat form', () => {
		const {errors} = parseScene(
			['beats:', '  - mira: {sfx: gasp}'].join('\n')
		);

		expect(errors).toHaveLength(1);
		expect(errors[0].hint).toMatch(/- sfx: gasp/);
	});

	it('is not an entity key', () => {
		const {errors} = parseScene(
			['cast:', '  mira: {at: 0, sfx: gasp}'].join('\n')
		);

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('unknown-key');
	});
});
