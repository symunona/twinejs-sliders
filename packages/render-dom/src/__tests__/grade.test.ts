/**
 * `grade:` — the filter a grade draws with, and the renderer putting it on the art.
 *
 * jsdom composites nothing, so the picture is not provable here (`.claude/TRAPS.md`). What
 * is pinned: the SVG tables ARE the asset editor's LUTs, the native string is the editor's
 * factors, one `<filter>` per distinct grade that goes away when nothing holds it, and the
 * renderer writing the filter where the stylesheet reads it.
 */

import {buildChannelLuts, buildColorMatrix} from '@sliders/scene-types';
import type {Stage, StageEntity, Transition} from '@sliders/scene-types';
import {DomRenderer} from '../dom-renderer';
import {
	GRADE_PX_VAR,
	gradeFilter,
	gradeFilterCount,
	gradeIsNative,
	holdGrade
} from '../grade';
import {createStubResolver} from '../stub-resolver';

describe('gradeFilter', () => {
	it('draws nothing for no grade, or one at rest', () => {
		expect(gradeFilter(undefined)).toEqual({css: ''});
		expect(gradeFilter({gamma: 1, warmth: 0})).toEqual({css: ''});
	});

	it('draws contrast, hue, saturation and blur natively, all four in one order', () => {
		const {css, svg} = gradeFilter({saturation: -20});

		expect(svg).toBeUndefined();
		expect(css).toBe(
			'contrast(1) hue-rotate(0deg) saturate(0.8) blur(calc(0px * var(--sliders-grade-px, 1)))'
		);
		expect(gradeFilter({contrast: 100, hue: -10, blur: 2}).css).toBe(
			'contrast(129.5) hue-rotate(-10deg) saturate(1) blur(calc(2px * var(--sliders-grade-px, 1)))'
		);
	});

	it('goes through SVG for anything CSS cannot say with the editor maths', () => {
		for (const key of [
			'brightness',
			'gamma',
			'shadows',
			'highlights',
			'pop',
			'warmth',
			'tint'
		] as const) {
			expect(gradeIsNative({[key]: key === 'gamma' ? 1.5 : 20})).toBe(false);
		}

		expect(gradeIsNative({contrast: 10, hue: 5, saturation: 3, blur: 1})).toBe(true);
	});

	it('builds the SVG tables from the asset editor LUTs, so they cannot drift', () => {
		const grade = {brightness: -15, saturation: -20, warmth: 30};
		const {css, svg} = gradeFilter(grade);
		const luts = buildChannelLuts(grade);

		expect(css).toBe(`url(#${svg!.id})`);
		expect(svg!.tables.r.split(' ').map(Number)).toEqual(
			Array.from(luts.r, value => Math.round((value / 255) * 1e4) / 1e4)
		);
		expect(svg!.tables.b.split(' ')).toHaveLength(256);

		const matrix = svg!.matrix!.split(' ').map(Number);
		const expected = buildColorMatrix(grade).map(v => Math.round(v * 1e4) / 1e4);

		expect(matrix).toEqual([
			...expected.slice(0, 3),
			0,
			0,
			...expected.slice(3, 6),
			0,
			0,
			...expected.slice(6, 9),
			0,
			0,
			0,
			0,
			0,
			1,
			0
		]);
	});

	it('leaves the matrix out when it would be the identity, and adds blur after', () => {
		const {css, svg} = gradeFilter({warmth: 30, blur: 3});

		expect(svg!.matrix).toBeUndefined();
		expect(css).toBe(
			`url(#${svg!.id}) blur(calc(3px * var(--sliders-grade-px, 1)))`
		);
	});

	it('names the same grade the same, and a different one differently', () => {
		expect(gradeFilter({warmth: 30}).svg!.id).toBe(
			gradeFilter({gamma: 1, warmth: 30}).svg!.id
		);
		expect(gradeFilter({warmth: 30}).svg!.id).not.toBe(
			gradeFilter({warmth: 40}).svg!.id
		);
	});
});

describe('holdGrade', () => {
	beforeEach(() => {
		document.head.innerHTML = '';
	});

	it('puts one <filter> in the shared defs per distinct grade, and counts holders', () => {
		const a = holdGrade(document, {warmth: 30});
		const b = holdGrade(document, {warmth: 30});
		const c = holdGrade(document, {tint: 10});
		const id = gradeFilter({warmth: 30}).svg!.id;
		const filter = document.getElementById(id)!;

		expect(filter.parentElement?.closest('#sliders-fx-defs')).not.toBeNull();
		expect(filter.getAttribute('color-interpolation-filters')).toBe('sRGB');
		expect(filter.querySelectorAll('feFuncR, feFuncG, feFuncB')).toHaveLength(3);
		expect(gradeFilterCount(document)).toBe(2);

		a.release();
		a.release();
		expect(document.getElementById(id)).not.toBeNull();
		b.release();
		expect(document.getElementById(id)).toBeNull();
		c.release();
		expect(gradeFilterCount(document)).toBe(0);
	});

	it('adds nothing to the document for a native grade', () => {
		const handle = holdGrade(document, {hue: 20});

		expect(handle.css).toMatch(/^contrast/);
		expect(gradeFilterCount(document)).toBe(0);
		handle.release();
	});
});

function makeMount(): HTMLElement {
	const el = document.createElement('div');

	Object.defineProperty(el, 'clientWidth', {value: 1600, configurable: true});
	Object.defineProperty(el, 'clientHeight', {value: 900, configurable: true});
	document.body.appendChild(el);

	return el;
}

function entity(patch: Partial<StageEntity> & {id: string}): StageEntity {
	return {
		at: {x: 0, y: 0},
		flip: false,
		kind: 'prop',
		opacity: 1,
		ref: patch.id,
		scale: 1,
		...patch
	};
}

function stage(entities: StageEntity[]): Stage {
	return {
		camera: {at: {x: 0, y: 0}, zoom: 1},
		entities: Object.fromEntries(entities.map(e => [e.id, e])),
		fx: []
	};
}

function gradeTransition(duration: number): Transition[] {
	return [{duration, entityId: 'lamp', kind: 'grade'}];
}

describe('DomRenderer and grade:', () => {
	const renderers: DomRenderer[] = [];

	beforeEach(() => {
		jest.useFakeTimers();
		document.head.innerHTML = '';
		document.body.innerHTML = '';
	});

	afterEach(() => {
		renderers.splice(0).forEach(renderer => renderer.destroy());
		jest.useRealTimers();
	});

	async function mounted() {
		const mount = makeMount();
		const renderer = new DomRenderer();

		renderers.push(renderer);

		await renderer.mount(mount, createStubResolver());

		const box = () =>
			mount.querySelector(".sliders-entity[data-entity-id='lamp']") as HTMLElement;

		return {box, mount, renderer};
	}

	const art = (box: HTMLElement) =>
		box.querySelector(':scope > .sliders-entity-art') as HTMLElement;

	it('writes the filter on the art wrapper, not the image or the box', async () => {
		const {box, renderer} = await mounted();

		await renderer.apply(stage([entity({grade: {hue: 20}, id: 'lamp'})]), []);
		expect(art(box()).style.filter).toBe(gradeFilter({hue: 20}).css);
		expect(art(box()).querySelector('img')).not.toBeNull();
		expect((art(box()).querySelector('img') as HTMLElement).style.filter).toBe('');
		expect(box().style.filter).toBe('');

		await renderer.apply(stage([entity({id: 'lamp'})]), []);
		expect(art(box()).style.filter).toBe('');
	});

	it('keeps the grade across a pose change: the wrapper stays, the image swaps', async () => {
		const {mount, renderer} = await mounted();
		const mira = (pose: string): StageEntity => ({
			...entity({grade: {warmth: 30}, id: 'mira', pose}),
			kind: 'cast',
			ref: 'mira'
		});
		const wrapper = () =>
			mount.querySelector(
				".sliders-entity[data-entity-id='mira'] > .sliders-entity-art"
			) as HTMLElement;

		await renderer.apply(stage([mira('idle')]), []);

		const before = wrapper();
		const img = before.querySelector('img');

		await renderer.apply(stage([mira('angry')]), [
			{duration: 0.2, entityId: 'mira', kind: 'pose'}
		]);

		expect(wrapper()).toBe(before);
		expect(before.querySelector('img:not(.sliders-ghost)')).not.toBe(img);
		expect(before.style.filter).toBe(gradeFilter({warmth: 30}).css);
		expect(document.getElementById(gradeFilter({warmth: 30}).svg!.id)).not.toBeNull();
	});

	it('keeps the grade while a step list swaps the picture on its own clock', async () => {
		const {mount, renderer} = await mounted();
		const walker: StageEntity = {
			...entity({grade: {warmth: 30}, id: 'mira', pose: 'idle'}),
			kind: 'cast',
			ref: 'mira',
			steps: [
				{dur: 0.1, name: 'idle'},
				{dur: 0.1, name: 'angry'}
			]
		};

		await renderer.apply(stage([walker]), []);

		const wrapper = mount.querySelector(
			".sliders-entity[data-entity-id='mira'] > .sliders-entity-art"
		) as HTMLElement;
		const first = wrapper.querySelector('img')?.getAttribute('src');

		jest.advanceTimersByTime(150);
		await Promise.resolve();

		expect(wrapper.isConnected).toBe(true);
		expect(wrapper.querySelector('img')?.getAttribute('src')).not.toBe(first);
		expect(wrapper.style.filter).toBe(gradeFilter({warmth: 30}).css);
	});

	it('times a native change on the beat, through the CSS transition', async () => {
		const {box, renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'lamp'})]), []);
		await renderer.apply(
			stage([entity({grade: {saturation: -50}, id: 'lamp'})]),
			gradeTransition(0.8)
		);
		expect(art(box()).style.transitionDuration).toBe('0.8s');
		expect(box().querySelector('.sliders-entity-art-ghost')).toBeNull();
	});

	it('cross-fades an SVG change: a copy of the wrapper with the old filter goes away', async () => {
		const {box, renderer} = await mounted();

		await renderer.apply(stage([entity({grade: {warmth: 30}, id: 'lamp'})]), []);

		const oldId = gradeFilter({warmth: 30}).svg!.id;

		await renderer.apply(
			stage([entity({grade: {warmth: 60}, id: 'lamp'})]),
			gradeTransition(0.5)
		);

		const ghost = box().querySelector(
			':scope > .sliders-entity-art-ghost'
		) as HTMLElement;

		expect(ghost).not.toBeNull();
		expect(ghost.style.filter).toBe(`url(#${oldId})`);
		expect(ghost.querySelector('img')).not.toBeNull();
		expect(art(box()).style.filter).toBe(gradeFilter({warmth: 60}).css);
		expect(art(box()).style.transitionDuration).toBe('0s');
		// Held until the ghost is gone: it is still drawing with it.
		expect(document.getElementById(oldId)).not.toBeNull();

		jest.advanceTimersByTime(600);
		expect(box().querySelector('.sliders-entity-art-ghost')).toBeNull();
		expect(document.getElementById(oldId)).toBeNull();
		expect(gradeFilterCount(document)).toBe(1);
	});

	it('snaps an SVG change with no duration, and frees the old filter at once', async () => {
		const {box, renderer} = await mounted();

		await renderer.apply(stage([entity({grade: {warmth: 30}, id: 'lamp'})]), []);
		await renderer.apply(stage([entity({grade: {tint: 10}, id: 'lamp'})]), []);

		expect(box().querySelector('.sliders-entity-art-ghost')).toBeNull();
		expect(gradeFilterCount(document)).toBe(1);
	});

	it('scales blur by the art, only while the grade blurs', async () => {
		const {box, renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'lamp'})]), []);
		expect(box().style.getPropertyValue(GRADE_PX_VAR)).toBe('');

		await renderer.apply(stage([entity({grade: {blur: 4}, id: 'lamp'})]), []);
		expect(Number(box().style.getPropertyValue(GRADE_PX_VAR))).toBeGreaterThan(0);
	});

	it('lets go of its filters when the sprite leaves and when the stage goes', async () => {
		const {renderer} = await mounted();

		await renderer.apply(stage([entity({grade: {warmth: 30}, id: 'lamp'})]), []);
		expect(gradeFilterCount(document)).toBe(1);
		await renderer.apply(stage([]), []);
		expect(gradeFilterCount(document)).toBe(0);

		await renderer.apply(stage([entity({grade: {warmth: 30}, id: 'lamp'})]), []);
		renderer.destroy();
		expect(gradeFilterCount(document)).toBe(0);
	});
});
