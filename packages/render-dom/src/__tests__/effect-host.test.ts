import {
	injectEffectCss,
	injectEffectSupport,
	pruneEffectCss,
	syncEffect
} from '../effect-host';
import {GLITCH_DEFAULTS, effectClass} from '../effects';
import type {GlitchEffect} from '@sliders/scene-types';

const SRC = 'blob:art';

function glitch(changes: Partial<GlitchEffect> = {}): GlitchEffect {
	return {...GLITCH_DEFAULTS, ...changes};
}

function host(): HTMLDivElement {
	const el = document.createElement('div');

	document.body.appendChild(el);
	return el;
}

function roles(el: HTMLElement): string[] {
	return Array.from(el.children).map(
		child => (child as HTMLElement).dataset.fx ?? ''
	);
}

describe('injectEffectSupport', () => {
	beforeEach(() => {
		document.head.innerHTML = '';
		document.body.innerHTML = '';
	});

	it('injects the shared stylesheet and the channel filters once', () => {
		injectEffectSupport(document);
		injectEffectSupport(document);

		expect(document.querySelectorAll('#sliders-fx-styles')).toHaveLength(1);
		expect(document.querySelectorAll('#sliders-fx-defs')).toHaveLength(1);
	});

	it('defines both filters the split layers point at', () => {
		injectEffectSupport(document);

		// A `filter: url(#id)` that resolves to nothing does not fall back -- the layer
		// simply draws the full-colour picture, and the "split" becomes a double image.
		expect(document.getElementById('sliders-fx-chan-a')).not.toBeNull();
		expect(document.getElementById('sliders-fx-chan-b')).not.toBeNull();
	});
});

describe('injectEffectCss', () => {
	beforeEach(() => {
		document.head.innerHTML = '';
	});

	it('writes one stylesheet per distinct parameter set', () => {
		injectEffectCss(glitch(), document);
		injectEffectCss(glitch(), document);
		injectEffectCss(glitch({bands: 8}), document);

		expect(
			document.querySelectorAll('style[data-sliders-fx=generated]')
		).toHaveLength(2);
	});

	it('does not rewrite a stylesheet that is already there', () => {
		// Rewriting a <style> restarts every animation in the document that uses it, so a
		// second sprite arriving with the same effect would visibly reset the first.
		const className = injectEffectCss(glitch(), document);
		const before = document.getElementById(className);

		injectEffectCss(glitch(), document);
		expect(document.getElementById(className)).toBe(before);
	});
});

describe('pruneEffectCss', () => {
	beforeEach(() => {
		document.head.innerHTML = '';
	});

	it('drops the stylesheets a drag left behind and keeps the live one', () => {
		for (const amount of [10, 20, 30, 40]) {
			injectEffectCss(glitch({amount}), document);
		}

		const keep = effectClass(glitch({amount: 40}));

		pruneEffectCss([keep], document);

		const left = Array.from(
			document.querySelectorAll('style[data-sliders-fx=generated]')
		).map(style => style.id);

		expect(left).toEqual([keep]);
	});

	it('leaves the shared stylesheet alone', () => {
		injectEffectCss(glitch(), document);
		pruneEffectCss([], document);

		expect(document.getElementById('sliders-fx-styles')).not.toBeNull();
	});
});

describe('syncEffect', () => {
	beforeEach(() => {
		document.head.innerHTML = '';
		document.body.innerHTML = '';
	});

	it('builds the layers the effect asks for, pointed at the art', () => {
		const el = host();

		syncEffect(el, glitch({bands: 2, noise: 0, scanlines: 0}), SRC);

		expect(roles(el)).toEqual(['split-a', 'split-b', 'band', 'band']);

		for (const img of Array.from(el.querySelectorAll('img'))) {
			expect(img.getAttribute('src')).toBe(SRC);
			// Decorative by definition: the asset itself is already in the page.
			expect(img.alt).toBe('');
		}
	});

	it('puts the generated class on the host', () => {
		const el = host();
		const effect = glitch();

		syncEffect(el, effect, SRC);

		expect(el.className).toBe(`sliders-fx ${effectClass(effect)}`);
		expect(el.dataset.fx).toBe('glitch');
	});

	it('keeps the elements it already has when a parameter changes', () => {
		// The whole point. A glitch is a running animation, and rebuilding the layers would
		// snap every one of them back to frame zero on each slider step.
		const el = host();

		syncEffect(el, glitch({bands: 3}), SRC);

		const before = Array.from(el.children);

		syncEffect(el, glitch({amount: 80, bands: 3}), SRC);

		expect(Array.from(el.children)).toEqual(before);
	});

	it('adds and removes band elements when the band count changes', () => {
		const el = host();

		syncEffect(el, glitch({bands: 4, noise: 0, scanlines: 0}), SRC);
		expect(el.querySelectorAll("[data-fx='band']")).toHaveLength(4);

		syncEffect(el, glitch({bands: 2, noise: 0, scanlines: 0}), SRC);
		expect(el.querySelectorAll("[data-fx='band']")).toHaveLength(2);
		expect(
			Array.from(el.querySelectorAll("[data-fx='band']")).map(
				band => (band as HTMLElement).dataset.band
			)
		).toEqual(['0', '1']);
	});

	it('builds the overlays as divs, not images', () => {
		const el = host();

		syncEffect(el, glitch({noise: 30, scanlines: 30}), SRC);

		expect(el.querySelector("[data-fx='scanlines']")!.tagName).toBe('DIV');
		expect(el.querySelector("[data-fx='noise']")!.tagName).toBe('DIV');
	});

	it('empties the host when the effect is cleared', () => {
		const el = host();

		syncEffect(el, glitch(), SRC);
		syncEffect(el, undefined, SRC);

		expect(el.children).toHaveLength(0);
		expect(el.className).toBe('sliders-fx');
		expect(el.dataset.fx).toBeUndefined();
	});

	it('empties the host when every knob is at zero', () => {
		const el = host();

		syncEffect(el, glitch(), SRC);
		syncEffect(
			el,
			glitch({amount: 0, noise: 0, scanlines: 0, split: 0}),
			SRC
		);

		expect(el.children).toHaveLength(0);
	});

	it('builds nothing without art to show', () => {
		const el = host();

		syncEffect(el, glitch(), undefined);
		expect(el.children).toHaveLength(0);
	});

	it('marks a plane so its layers cover rather than contain', () => {
		const el = host();

		syncEffect(el, glitch(), SRC, {fit: 'cover'});
		expect(el.dataset.fxFit).toBe('cover');

		syncEffect(el, glitch(), SRC, {fit: 'contain'});
		expect(el.dataset.fxFit).toBeUndefined();
	});

	it('copies the sprite object-position onto the art layers', () => {
		// A layer a few percent off the art it is torn from reads as a permanent double
		// image rather than as a tear, and a stylesheet cannot outrank `applyFrameFit`'s
		// inline value -- so this has to be inline too.
		const el = host();

		syncEffect(el, glitch({bands: 1}), SRC, {objectPosition: '50% 100%'});

		for (const img of Array.from(el.querySelectorAll('img'))) {
			expect(img.style.objectPosition).toBe('50% 100%');
		}
	});
});
