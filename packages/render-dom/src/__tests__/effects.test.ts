import {
	GLITCH_DEFAULTS,
	GLITCH_RANGES,
	effectClass,
	effectCss,
	effectIsIdle,
	effectLayers,
	normalizeEffect,
	normalizeGlitch,
	sameEffect
} from '../effects';
import type {GlitchEffect} from '@sliders/scene-types';

function glitch(changes: Partial<GlitchEffect> = {}): GlitchEffect {
	return {...GLITCH_DEFAULTS, ...changes};
}

/** Every `@keyframes NAME` block in a stylesheet. */
function keyframeNames(css: string): string[] {
	return [...css.matchAll(/@keyframes ([\w-]+)/g)].map(match => match[1]);
}

/** The stops inside one named block, as `['0%', '12.5%', …]`. */
function stopsOf(css: string, name: string): string[] {
	const block = css.slice(css.indexOf(`@keyframes ${name}`));

	return [...block.slice(0, block.indexOf('\n}')).matchAll(/^\t([\d.]+)%/gm)].map(
		match => match[1] + '%'
	);
}

describe('normalizeGlitch', () => {
	it('clamps every parameter into its own range', () => {
		const wild = normalizeGlitch({
			amount: 9000,
			bands: -4,
			burst: -1,
			noise: 1e9,
			period: 0,
			scanlines: 250,
			speed: 0,
			split: -30
		});

		for (const key of Object.keys(GLITCH_RANGES) as (keyof typeof GLITCH_RANGES)[]) {
			expect(wild[key]).toBeGreaterThanOrEqual(GLITCH_RANGES[key].min);
			expect(wild[key]).toBeLessThanOrEqual(GLITCH_RANGES[key].max);
		}
	});

	it('falls back to the default for a parameter that is not a number', () => {
		// What a hand-edited manifest, an older bundle or a half-written sync payload
		// actually delivers. NaN would reach the stylesheet as `translate: NaN%`, which
		// invalidates the whole declaration and silently drops the effect.
		const broken = normalizeGlitch({
			amount: NaN,
			bands: undefined,
			speed: 'fast' as unknown as number
		});

		expect(broken.amount).toBe(GLITCH_DEFAULTS.amount);
		expect(broken.bands).toBe(GLITCH_DEFAULTS.bands);
		expect(broken.speed).toBe(GLITCH_DEFAULTS.speed);
	});

	it('rejects an effect of an unknown kind rather than guessing', () => {
		expect(normalizeEffect({kind: 'bloom'} as never)).toBeUndefined();
		expect(normalizeEffect(undefined)).toBeUndefined();
	});
});

describe('effectIsIdle', () => {
	it('is idle when every knob that draws something is at zero', () => {
		expect(
			effectIsIdle(
				glitch({amount: 0, noise: 0, scanlines: 0, split: 0})
			)
		).toBe(true);
	});

	it('is idle when the tear is wide but never happens', () => {
		// `burst: 0` means no frame is ever corrupted, so `amount` has nothing to act on.
		// Without this the pane would build a full band stack that animates to nothing.
		expect(
			effectIsIdle(glitch({amount: 100, burst: 0, noise: 0, scanlines: 0, split: 0}))
		).toBe(true);
	});

	it('is not idle when only an overlay is turned up', () => {
		expect(
			effectIsIdle(glitch({amount: 0, noise: 0, scanlines: 40, split: 0}))
		).toBe(false);
	});
});

describe('effectClass', () => {
	it('is stable across calls, so a reload reuses the same generated rule', () => {
		expect(effectClass(glitch())).toBe(effectClass(glitch()));
	});

	it('ignores key order and out-of-range noise the normalizer would flatten', () => {
		expect(effectClass({...glitch(), amount: 200})).toBe(
			effectClass(glitch({amount: 100}))
		);
	});

	it('differs when a parameter differs', () => {
		expect(effectClass(glitch())).not.toBe(effectClass(glitch({amount: 36})));
	});
});

describe('sameEffect', () => {
	it('treats absent and every-knob-at-zero as the same thing', () => {
		expect(
			sameEffect(
				undefined,
				glitch({amount: 0, noise: 0, scanlines: 0, split: 0})
			)
		).toBe(true);
	});

	it('sees a real change', () => {
		expect(sameEffect(glitch(), glitch({bands: 6}))).toBe(false);
		expect(sameEffect(glitch(), undefined)).toBe(false);
	});
});

describe('effectLayers', () => {
	it('builds one layer per band plus the two channel copies', () => {
		const layers = effectLayers(glitch({bands: 3, noise: 0, scanlines: 0}));

		expect(layers.filter(layer => layer.role === 'band').map(l => l.band)).toEqual([
			0, 1, 2
		]);
		expect(layers.filter(layer => layer.role.startsWith('split'))).toHaveLength(2);
	});

	it('leaves out the layers whose parameter is zero', () => {
		const layers = effectLayers(
			glitch({amount: 0, noise: 0, scanlines: 0, split: 40})
		);

		expect(layers.map(layer => layer.role)).toEqual(['split-a', 'split-b']);
	});

	it('builds nothing for an idle effect', () => {
		expect(effectLayers(undefined)).toEqual([]);
		expect(
			effectLayers(glitch({amount: 0, noise: 0, scanlines: 0, split: 0}))
		).toEqual([]);
	});

	it('puts the overlays last, so they sit on top of the tear', () => {
		const roles = effectLayers(glitch({noise: 30, scanlines: 30})).map(
			layer => layer.role
		);

		expect(roles.slice(-2)).toEqual(['scanlines', 'noise']);
	});
});

describe('effectCss', () => {
	it('is deterministic — the same parameters give byte-identical CSS', () => {
		// The whole reason the generator is seeded. An author sets a look, saves, reopens,
		// and has to see the tear they approved rather than a fresh roll of the dice.
		expect(effectCss(glitch())).toBe(effectCss(glitch()));
	});

	it('scopes every rule to the effect class', () => {
		const scope = effectClass(glitch());
		const rules = effectCss(glitch())
			.split('\n\n')
			.filter(rule => rule.startsWith('.'));

		expect(rules.length).toBeGreaterThan(0);

		for (const rule of rules) {
			expect(rule.startsWith(`.${scope} `)).toBe(true);
		}
	});

	it('gives each band a clip path that tiles the picture with no seam', () => {
		const css = effectCss(glitch({bands: 4}));
		const insets = [...css.matchAll(/inset\(([\d.]+)% 0 ([\d.]+)% 0\)/g)].map(
			match => [Number(match[1]), Number(match[2])]
		);

		expect(insets).toEqual([
			[0, 75],
			[25, 50],
			[50, 25],
			[75, 0]
		]);

		// Each band's top edge is exactly where the one above it stopped.
		for (const [top, bottom] of insets) {
			expect(top + (100 - bottom - top) + bottom).toBe(100);
		}
	});

	it('gives every band its own track, so they tear independently', () => {
		const css = effectCss(glitch({bands: 5, noise: 0, scanlines: 0}));
		const bandTracks = keyframeNames(css).filter(name => name.includes('-band-'));

		expect(bandTracks).toHaveLength(5);
		expect(new Set(bandTracks).size).toBe(5);

		// Two bands rolling the same offsets would read as the picture shaking as a unit.
		const tracks = bandTracks.map(name => stopsOf(css, name).join(','));

		expect(new Set(tracks).size).toBeGreaterThan(1);
	});

	it('collapses a run of equal frames into one stop', () => {
		// With a low burst most frames are `translate: 0 0`, and the naive track is one stop
		// per frame. `steps(1, end)` holds a value until the next stop either way, so the
		// collapsed track runs identically -- it is just not forty lines of the same thing.
		const quiet = effectCss(glitch({bands: 1, burst: 5, noise: 0, scanlines: 0}));
		const busy = effectCss(glitch({bands: 1, burst: 95, noise: 0, scanlines: 0}));
		const quietStops = stopsOf(quiet, keyframeNames(quiet)[0]).length;
		const busyStops = stopsOf(busy, keyframeNames(busy)[0]).length;

		expect(quietStops).toBeLessThan(busyStops);
	});

	it('holds the loop open to 100%, so nothing eases back early', () => {
		const css = effectCss(glitch({bands: 1}));

		for (const name of keyframeNames(css)) {
			expect(stopsOf(css, name).pop()).toBe('100%');
		}
	});

	it('steps rather than interpolates', () => {
		expect(effectCss(glitch())).toContain('animation-timing-function: steps(1, end)');
	});

	it('caps the stop count however fast and long the loop is', () => {
		// 8s at 50 steps/s is 400 frames, per band. Uncapped that is a stylesheet measured in
		// tens of kilobytes for a difference nobody can see.
		const css = effectCss(glitch({bands: 12, burst: 100, period: 8, speed: 50}));

		for (const name of keyframeNames(css)) {
			expect(stopsOf(css, name).length).toBeLessThanOrEqual(49);
		}
	});

	it('writes no keyframes for a parameter that is at zero', () => {
		const css = effectCss(
			glitch({amount: 0, noise: 0, scanlines: 0, split: 40})
		);

		expect(keyframeNames(css).some(name => name.includes('-band-'))).toBe(false);
		expect(css).toContain('split-a');
	});

	it('never emits a NaN into a declaration', () => {
		// One NaN invalidates its declaration and the effect silently half-draws, which is
		// exactly the failure the normalizer exists to stop. Cheap to assert, so assert it.
		const css = effectCss(
			normalizeGlitch({amount: NaN, bands: Infinity, period: -0} as never)
		);

		expect(css).not.toMatch(/NaN|Infinity|undefined/);
	});
});

describe('rotate', () => {
	it('is off by default, so an asset saved before the key existed looks unchanged', () => {
		expect(GLITCH_DEFAULTS.rotate).toBe(0);
		expect(normalizeGlitch({}).rotate).toBe(0);
	});

	it('leaves the class name alone while it is at zero', () => {
		// The class is also the SEED. If adding a parameter moved the hash, every glitch an
		// author had already tuned would come back with a different pseudo-random tear.
		const {rotate, ...without} = glitch();

		expect(effectClass(without as GlitchEffect)).toBe(effectClass(glitch()));
		expect(effectClass(glitch({rotate: 0}))).toBe(effectClass(glitch()));
	});

	it('changes the class name once it is set', () => {
		expect(effectClass(glitch({rotate: 8}))).not.toBe(effectClass(glitch()));
	});

	it('writes no rotate declaration while it is at zero', () => {
		expect(effectCss(glitch())).not.toContain('rotate:');
	});

	it('gives every band a rotation alongside its slide', () => {
		const css = effectCss(glitch({bands: 2, burst: 100, rotate: 10}));

		for (const name of keyframeNames(css).filter(n => n.includes('-band-'))) {
			const block = css.slice(css.indexOf(`@keyframes ${name}`));

			expect(block.slice(0, block.indexOf('\n}'))).toMatch(
				/translate: [-\d.]+% 0; rotate: [-\d.]+deg;/
			);
		}
	});

	it('stays inside the angle the author asked for', () => {
		const css = effectCss(glitch({burst: 100, rotate: 6}));

		for (const match of css.matchAll(/rotate: ([-\d.]+)deg/g)) {
			expect(Math.abs(Number(match[1]))).toBeLessThanOrEqual(6);
		}
	});

	it('tears on its own, with no sideways slide at all', () => {
		// A twist with `amount` at zero is a strip of the picture lifting off and coming
		// back — a real look, and the reason the band gate asks for either knob rather than
		// for `amount` alone.
		const twisted = glitch({amount: 0, noise: 0, rotate: 12, scanlines: 0, split: 0});

		expect(effectIsIdle(twisted)).toBe(false);
		expect(effectLayers(twisted).map(layer => layer.role)).toEqual([
			'band',
			'band',
			'band',
			'band',
			'band'
		]);
		expect(effectCss(twisted)).toContain('rotate:');
	});

	it('draws nothing when nothing is ever corrupted', () => {
		// `burst` gates the twist the same way it gates the slide: no burst, no tear.
		expect(
			effectIsIdle(
				glitch({amount: 0, burst: 0, noise: 0, rotate: 12, scanlines: 0, split: 0})
			)
		).toBe(true);
	});

	it('is a real change to sameEffect', () => {
		expect(sameEffect(glitch(), glitch({rotate: 10}))).toBe(false);
	});
});
