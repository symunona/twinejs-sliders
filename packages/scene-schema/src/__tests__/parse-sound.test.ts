import {parseScene} from '../parse-scene';

describe('music:', () => {
	it('takes a bare name', () => {
		const {scene, errors} = parseScene('music: tavern-loop');

		expect(errors).toEqual([]);
		// Single form: track `main`, marked single so it LOOPS (applyMusic) — the old bed's
		// meaning, kept. The loop is not stamped: unstated stays unstated.
		expect(scene.music).toEqual({
			single: true,
			tracks: {main: {amount: 1, id: 'tavern-loop'}}
		});
	});

	it('takes the name@volume token fx: already uses', () => {
		const {scene, errors} = parseScene('music: tavern-loop@0.4');

		expect(errors).toEqual([]);
		expect(scene.music).toEqual({
			single: true,
			tracks: {main: {amount: 0.4, id: 'tavern-loop'}}
		});
	});

	it('takes the long form, spelling the number volume:', () => {
		const {scene, errors} = parseScene('music: {id: rain, volume: 0.25}');

		expect(errors).toEqual([]);
		expect(scene.music).toEqual({
			single: true,
			tracks: {main: {amount: 0.25, id: 'rain'}}
		});
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

		expect(scene.music).toEqual({single: true, tracks: {main: {amount: 1, id: '04'}}});
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

describe('music: single form, new keys', () => {
	it('takes every track key, with CSS-like seconds', () => {
		const {scene, errors} = parseScene(
			'music: {id: rain, volume: 0.4, loop: false, fade: 3s, start: 500ms, restart: true}'
		);

		expect(errors).toEqual([]);
		expect(scene.music).toEqual({
			single: true,
			tracks: {
				main: {amount: 0.4, fade: 3, id: 'rain', loop: false, restart: true, start: 0.5}
			}
		});
	});

	it('takes a bare number as seconds', () => {
		const {scene} = parseScene('music: {id: rain, fade: 2, start: 90}');

		// No 60s warning on start: four minutes into a track is ordinary.
		expect(parseScene('music: {id: rain, start: 240}').errors).toEqual([]);
		expect(scene.music?.tracks.main).toMatchObject({fade: 2, start: 90});
	});

	it('takes stop-other-tracks beside the id', () => {
		const {scene, errors} = parseScene('music: {id: rain, stop-other-tracks: all}');

		expect(errors).toEqual([]);
		expect(scene.music).toEqual({
			single: true,
			stopOthers: 'all',
			tracks: {main: {id: 'rain'}}
		});
	});

	it('still needs an id when it is plainly a single form', () => {
		const {scene, errors} = parseScene('music: {volume: 0.4}');

		expect(errors).toHaveLength(1);
		expect(errors[0].message).toMatch(/needs an id/);
		expect(scene.music).toBeUndefined();
	});

	it('offers a fix for a misspelt key', () => {
		const {errors} = parseScene('music: {id: rain, lop: true}');

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('unknown-key');
		expect(errors[0].fix?.text).toBe('loop');
	});

	it('rejects a bad time', () => {
		const {errors} = parseScene('music: {id: rain, fade: soon}');

		expect(errors).toHaveLength(1);
		expect(errors[0].message).toMatch(/length of time/);
		expect(errors[0].hint).toMatch(/2s/);
	});

	it('rejects a negative time', () => {
		const {errors} = parseScene('music: {id: rain, fade: -1s}');

		expect(errors).toHaveLength(1);
		expect(errors[0].message).toMatch(/not a length of time/);
	});
});

describe('music: loop', () => {
	const loopOf = (yaml: string) => parseScene(`music: {id: x, loop: ${yaml}}`);

	it('takes true and false', () => {
		expect(loopOf('true').scene.music?.tracks.main?.loop).toBe(true);
		expect(loopOf('false').scene.music?.tracks.main?.loop).toBe(false);
	});

	it('keeps a stated loop apart from an unstated one, default or not', () => {
		// Bug report: `loop: true` on the bed equals its default, and the editor showed it as
		// unset. The parse must say which one the author wrote.
		expect(loopOf('true').scene.music?.tracks.main).toHaveProperty('loop', true);
		expect(parseScene('music: {id: x}').scene.music?.tracks.main).not.toHaveProperty('loop');
		expect(parseScene('music: x').scene.music?.tracks.main).not.toHaveProperty('loop');
	});

	it('takes a count of plays, and 1 is false', () => {
		expect(loopOf('3').scene.music?.tracks.main?.loop).toBe(3);
		expect(loopOf('1').scene.music?.tracks.main?.loop).toBe(false);
	});

	it.each(['0', '-2', '1.5'])('refuses %s plays', count => {
		const {errors} = loopOf(count);

		expect(errors).toHaveLength(1);
		expect(errors[0].message).toMatch(/not a number of plays/);
	});

	it('takes a section, with units', () => {
		const {scene, errors} = loopOf('{from: 2s, to: 14500ms}');

		expect(errors).toEqual([]);
		expect(scene.music?.tracks.main?.loop).toEqual({from: 2, to: 14.5});
	});

	it('reads a section without from: as from the top', () => {
		expect(loopOf('{to: 8s}').scene.music?.tracks.main?.loop).toEqual({from: 0, to: 8});
		expect(loopOf('{from: 3}').scene.music?.tracks.main?.loop).toEqual({from: 3});
	});

	it('refuses a section that ends before it starts', () => {
		const {errors} = loopOf('{from: 10s, to: 4s}');

		expect(errors).toHaveLength(1);
		expect(errors[0].message).toMatch(/end after it starts/);
	});

	it('offers a fix for a misspelt section key', () => {
		const {errors} = loopOf('{form: 2, to: 4}');

		expect(errors).toHaveLength(1);
		expect(errors[0].fix?.text).toBe('from');
	});

	it('refuses a word', () => {
		const {errors} = loopOf('forever');

		expect(errors).toHaveLength(1);
		expect(errors[0].hint).toMatch(/from: 2s/);
	});
});

describe('music: keyed tracks', () => {
	it('reads every key as a track, entries defaulting to no loop', () => {
		const {scene, errors} = parseScene(
			[
				'music:',
				'  mellow: {id: x, volume: 0.5, loop: true, fade: 2s}',
				'  drums: drum-loop@0.3',
				'  wind: {volume: 0.2}',
				'  rain: ~'
			].join('\n')
		);

		expect(errors).toEqual([]);
		// No `loop` stamped on keyed entries: applyMusic's default (false) is theirs.
		expect(scene.music).toEqual({
			tracks: {
				drums: {amount: 0.3, id: 'drum-loop'},
				mellow: {amount: 0.5, fade: 2, id: 'x', loop: true},
				rain: null,
				wind: {amount: 0.2}
			}
		});
		expect(Object.keys(scene.music!.tracks)).toEqual(['mellow', 'drums', 'wind', 'rain']);
	});

	it('takes a track called main, the one the single form writes', () => {
		const {scene} = parseScene('music: {main: rain}');

		expect(scene.music).toEqual({tracks: {main: {amount: 1, id: 'rain'}}});
	});

	it.each([
		['all', 'all'],
		['[a, b]', ['a', 'b']],
		['a', ['a']]
	])('takes stop-other-tracks: %s', (yaml, want) => {
		const {scene, errors} = parseScene(
			['music:', '  x: y', `  stop-other-tracks: ${yaml}`].join('\n')
		);

		expect(errors).toEqual([]);
		expect(scene.music).toEqual({stopOthers: want, tracks: {x: {amount: 1, id: 'y'}}});
	});

	it('takes stop-other-tracks alone', () => {
		const {scene, errors} = parseScene('music: {stop-other-tracks: all}');

		expect(errors).toEqual([]);
		expect(scene.music).toEqual({stopOthers: 'all', tracks: {}});
	});

	it('points stop-other-tracks: true at all', () => {
		const {errors} = parseScene('music: {x: y, stop-other-tracks: true}');

		expect(errors).toHaveLength(1);
		expect(errors[0].fix?.text).toBe('all');
	});

	it('does not read a misspelt stop-other-tracks as a track', () => {
		const {scene, errors} = parseScene('music: {x: y, stop-others: all}');

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('unknown-key');
		expect(errors[0].fix?.text).toBe('stop-other-tracks');
		expect(scene.music?.tracks).toEqual({x: {amount: 1, id: 'y'}});
	});

	it('warns that a fractional scalar is a name, not a volume', () => {
		const {scene, errors} = parseScene('music: {wind: 0.2}');

		expect(errors).toHaveLength(1);
		expect(errors[0].severity).toBe('warning');
		expect(errors[0].hint).toMatch(/wind: \{volume: 0.2\}/);
		expect(scene.music?.tracks.wind).toEqual({amount: 1, id: '0.2'});
	});

	it('says stop-other-tracks belongs beside the tracks, not in one', () => {
		const {errors} = parseScene('music: {x: {id: y, stop-other-tracks: all}}');

		expect(errors).toHaveLength(1);
		expect(errors[0].hint).toMatch(/whole music: map/);
	});

	it('keeps the volume-not-amount hint inside a track', () => {
		const {errors} = parseScene('music: {x: {id: y, amount: 0.5}}');

		expect(errors).toHaveLength(1);
		expect(errors[0].hint).toMatch(/volume/);
	});
});

describe('music: on beats', () => {
	const beats = (...lines: string[]) =>
		parseScene(['beats:', ...lines.map(line => `  ${line}`)].join('\n'));

	it('is a beat of its own', () => {
		const {scene, errors} = beats('- music: {drums: drum@0.5}');

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toEqual({
			index: 0,
			kind: 'music',
			music: {tracks: {drums: {amount: 0.5, id: 'drum'}}}
		});
	});

	it('takes the single form as a beat, still looping', () => {
		const {scene} = beats('- music: storm');

		expect(scene.beats[0]).toMatchObject({
			kind: 'music',
			music: {single: true, tracks: {main: {id: 'storm'}}}
		});
	});

	it('takes ~ as a beat, kept as null', () => {
		const {scene, errors} = beats('- music: ~');

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toEqual({index: 0, kind: 'music', music: null});
	});

	it('rides on a spoken line', () => {
		const {scene, errors} = beats('- mira: {say: "Hush.", music: {rain: ~}}');

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toMatchObject({
			kind: 'say',
			music: {tracks: {rain: null}}
		});
	});

	it('rides on a spoken line as ~', () => {
		const {scene} = beats('- mira: {say: "Hush.", music: ~}');

		expect(scene.beats[0]).toMatchObject({kind: 'say', music: null});
	});

	it('rides on a stage move', () => {
		const {scene, errors} = beats('- mira: {at: 0.3, music: calm}');

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toMatchObject({kind: 'set', music: {tracks: {main: {id: 'calm'}}}});
	});

	it('rides on a narration box', () => {
		const {scene, errors} = beats('- box: {text: "Later.", music: {drums: ~}}');

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toMatchObject({kind: 'box', music: {tracks: {drums: null}}});
	});

	it('sends a speaker-only music beat to the beat form', () => {
		const {errors} = beats('- mira: {music: calm}');

		expect(errors).toHaveLength(1);
		expect(errors[0].hint).toMatch(/- music:/);
	});

	it('is not an entity key', () => {
		const {errors} = parseScene(['cast:', '  mira: {at: 0, music: calm}'].join('\n'));

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('unknown-key');
	});

	it('leaves beats without music alone', () => {
		const {scene} = beats('- mira: "Hi."');

		expect('music' in scene.beats[0]).toBe(false);
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
