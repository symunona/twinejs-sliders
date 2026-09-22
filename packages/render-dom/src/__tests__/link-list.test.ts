/**
 * The in-stage link list: its markup, its clicks and where it lands.
 *
 * The attribute names are the dialogue layer's own (`data-sliders-link` /
 * `data-sliders-target`), so a host binds ONE handler and gets bubble links, clickable props
 * and this menu alike — these tests are what stops that contract being renamed on one side
 * only. jsdom does no layout, so a list with no stated `h:` measures zero tall and the
 * numbers below are the geometry with that height, not a browser's.
 */

import type {LinkListStyle} from '@sliders/scene-types';
import type {MeasuringRenderer} from '../dialogue';
import {LinkListLayer} from '../link-list';

const BOX = {left: 0, top: 0, width: 1600, height: 900};

function setup(subscribe?: MeasuringRenderer['subscribe']) {
	const mount = document.createElement('div');

	Object.defineProperty(mount, 'clientWidth', {
		value: 1600,
		configurable: true
	});
	Object.defineProperty(mount, 'clientHeight', {
		value: 900,
		configurable: true
	});
	document.body.appendChild(mount);

	const renderer: MeasuringRenderer = {
		measure: () => ({x: 800, y: 450}),
		stageBox: () => BOX,
		subscribe
	};

	const list = new LinkListLayer();

	list.mount(mount, renderer);

	return {mount, list, renderer};
}

function root(mount: HTMLElement): HTMLElement | null {
	return mount.querySelector('.sliders-linklist');
}

function links(mount: HTMLElement): HTMLElement[] {
	return [
		...mount.querySelectorAll('.sliders-linklist a.sliders-link')
	] as HTMLElement[];
}

const ENTRIES = [
	{name: 'stay', to: 'Tavern Fight'},
	{name: 'leave', to: 'Street'}
];

describe('LinkListLayer', () => {
	afterEach(() => document.body.replaceChildren());

	it('renders every entry as an anchor carrying its name and target', () => {
		const {mount, list} = setup();

		list.set(ENTRIES, {});

		const a = links(mount);

		expect(a.map(el => el.dataset.slidersLink)).toEqual(['stay', 'leave']);
		expect(a.map(el => el.dataset.slidersTarget)).toEqual([
			'Tavern Fight',
			'Street'
		]);
		expect(a.map(el => el.textContent)).toEqual(['stay', 'leave']);
		expect(a[0].getAttribute('href')).toBe('#');
	});

	it('reports a click with the name and the target', () => {
		const {mount, list} = setup();
		const seen: [string, string | undefined][] = [];

		list.onLink = (name, target) => seen.push([name, target]);
		list.set(ENTRIES, {});

		links(mount)[1].click();

		expect(seen).toEqual([['leave', 'Street']]);
	});

	it('hands the click event on, so a host can read its modifiers', () => {
		const {mount, list} = setup();
		const events: (MouseEvent | undefined)[] = [];

		list.onLink = (_name, _target, event) => events.push(event);
		list.set(ENTRIES, {});

		links(mount)[0].dispatchEvent(
			new MouseEvent('click', {bubbles: true, cancelable: true, metaKey: true})
		);

		expect(events[0]?.metaKey).toBe(true);
		expect(events[0]?.defaultPrevented).toBe(true);
	});

	it('puts `as:` on the root as data-style, and takes it off again', () => {
		const {mount, list} = setup();

		list.set(ENTRIES, {as: 'parchment'});
		expect(root(mount)!.dataset.style).toBe('parchment');

		list.set(ENTRIES, {});
		expect(root(mount)!.dataset.style).toBeUndefined();
	});

	it('lets an entry overrule the list default for icon and transition', () => {
		const {mount, list} = setup();
		const style: LinkListStyle = {icon: 'door', transition: 'fade'};

		list.set(
			[
				{name: 'stay', to: 'Tavern Fight'},
				{name: 'leave', to: 'Street', icon: 'boot', transition: 'cut'}
			],
			style
		);

		const a = links(mount);

		expect(a[0].dataset.icon).toBe('door');
		expect(a[0].dataset.transition).toBe('fade');
		expect(a[1].dataset.icon).toBe('boot');
		expect(a[1].dataset.transition).toBe('cut');
	});

	it('leaves data-icon off when neither the entry nor the list names one', () => {
		const {mount, list} = setup();

		list.set(ENTRIES, {});

		expect(links(mount)[0].dataset.icon).toBeUndefined();
	});

	it('falls back to a centred list near the bottom, 0.8 of the stage wide', () => {
		const {mount, list} = setup();

		list.set(ENTRIES, {});

		const el = root(mount)!;

		// w 0.8 of 1600; at {0.5, 0.86} is the CENTRE, so left = 800 - 1280 / 2.
		expect(el.style.width).toBe('1280px');
		expect(el.style.height).toBe('');
		expect(el.style.transform).toBe('translate(160px, 774px)');
	});

	it('reads at:, w: and h: as fractions of the stage box', () => {
		const {mount, list} = setup();

		list.set(ENTRIES, {at: {x: 0.3, y: 0.5}, w: 0.5, h: 0.2});

		const el = root(mount)!;

		expect(el.style.width).toBe('800px');
		expect(el.style.height).toBe('180px');
		// Centre {480, 450} less half of 800 x 180.
		expect(el.style.transform).toBe('translate(80px, 360px)');
	});

	it('clamps a list parked off the stage back into the box', () => {
		const {mount, list} = setup();

		list.set(ENTRIES, {at: {x: 1.4, y: 0.5}, w: 0.5});

		// maxLeft = 1600 - 800 - 12.
		expect(root(mount)!.style.transform).toContain('788px');
	});

	it('does not duplicate nodes when set is called again', () => {
		const {mount, list} = setup();

		list.set(ENTRIES, {});

		const first = root(mount);

		list.set(ENTRIES, {});
		list.set(ENTRIES, {as: 'parchment'});

		expect(root(mount)).toBe(first);
		expect(mount.querySelectorAll('.sliders-linklist')).toHaveLength(1);
		expect(links(mount)).toHaveLength(2);
	});

	it('rebuilds the entries when the list itself changed', () => {
		const {mount, list} = setup();

		list.set(ENTRIES, {});
		list.set([{name: 'run', to: 'Alley'}], {});

		expect(links(mount).map(a => a.dataset.slidersLink)).toEqual(['run']);
	});

	it('clears on an empty list or a missing style', () => {
		const {mount, list} = setup();

		list.set(ENTRIES, {});
		list.set([], {});
		expect(root(mount)).toBeNull();

		list.set(ENTRIES, {});
		expect(links(mount)).toHaveLength(2);

		// No `linkList:` in the scene at all — the player's own markup is the list again.
		list.set(ENTRIES, undefined);
		expect(root(mount)).toBeNull();
	});

	it('still reports clicks after a clear and a re-set', () => {
		const {mount, list} = setup();
		const seen: string[] = [];

		list.onLink = name => seen.push(name);
		list.set(ENTRIES, {});
		list.set([], {});
		list.set(ENTRIES, {});

		links(mount)[0].click();

		expect(seen).toEqual(['stay']);
	});

	it('repositions when the renderer says something moved', () => {
		const listeners: (() => void)[] = [];
		const mount = document.createElement('div');

		document.body.appendChild(mount);

		let box = BOX;
		const list = new LinkListLayer();

		list.mount(mount, {
			measure: () => null,
			stageBox: () => box,
			subscribe: fn => {
				listeners.push(fn);

				return () => undefined;
			}
		});
		list.set(ENTRIES, {});

		const el = root(mount)!;
		const before = el.style.transform;

		box = {left: 0, top: 0, width: 800, height: 450};
		listeners.forEach(fn => fn());

		expect(el.style.transform).not.toBe(before);
		expect(el.style.width).toBe('640px');
	});

	it('destroy takes the root off the stage', () => {
		const {mount, list} = setup();

		list.set(ENTRIES, {});
		expect(root(mount)).not.toBeNull();

		list.destroy();
		expect(root(mount)).toBeNull();

		// And a destroyed layer is inert rather than throwing.
		list.set(ENTRIES, {});
		expect(root(mount)).toBeNull();
	});
});
