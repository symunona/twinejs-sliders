/**
 * A clickable entity in the DOM: the attributes, and the one delegated listener.
 *
 * The attribute names are deliberately the dialogue layer's own
 * (`data-sliders-link`/`data-sliders-target`), so a host binds ONE handler and gets bubble
 * links and clickable props alike — these tests are what stops that contract being renamed
 * on one side only. jsdom does no layout and no CSS, so the glow itself is the browser's
 * job and only the hooks it hangs off are pinned here.
 */

import type {Stage, StageEntity} from '@sliders/scene-types';
import {DomRenderer} from '../dom-renderer';
import {createStubResolver} from '../stub-resolver';

function makeMount(width = 1600, height = 900): HTMLElement {
	const el = document.createElement('div');

	Object.defineProperty(el, 'clientWidth', {value: width, configurable: true});
	Object.defineProperty(el, 'clientHeight', {value: height, configurable: true});
	document.body.appendChild(el);

	return el;
}

function entity(patch: Partial<StageEntity> & {id: string}): StageEntity {
	return {
		kind: 'prop',
		ref: patch.id,
		at: {x: 0, y: 0},
		flip: false,
		opacity: 1,
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

async function mounted(onLink?: jest.Mock) {
	const mount = makeMount();
	const renderer = new DomRenderer(onLink ? {onLink} : {});

	await renderer.mount(mount, createStubResolver());

	return {mount, renderer};
}

function elFor(mount: HTMLElement, id: string): HTMLElement {
	return mount.querySelector(
		`.sliders-entity[data-entity-id='${id}']`
	) as HTMLElement;
}

describe('link attributes', () => {
	it('marks a linked entity, and leaves scenery alone', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(
			stage([
				entity({id: 'door', link: {to: 'Cellar'}}),
				entity({id: 'rock'})
			])
		);

		const door = elFor(mount, 'door');

		expect(door.dataset.slidersLink).toBe('Cellar');
		expect(door.dataset.slidersTarget).toBe('Cellar');
		expect(door.getAttribute('role')).toBe('link');
		expect(door.getAttribute('tabindex')).toBe('0');

		const rock = elFor(mount, 'rock');

		expect(rock.dataset.slidersLink).toBeUndefined();
		expect(rock.getAttribute('role')).toBeNull();
	});

	it('carries the links: entry NAME when the author named one', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(
			stage([entity({id: 'gate', link: {name: 'escape', to: 'Alley'}})])
		);

		// The name is what the player looks up in its already-if:-filtered link map.
		expect(elFor(mount, 'gate').dataset.slidersLink).toBe('escape');
		expect(elFor(mount, 'gate').dataset.slidersTarget).toBe('Alley');
	});

	it('takes the marks off again when a beat clears the link', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'door', link: {to: 'Cellar'}})]));
		await renderer.apply(stage([entity({id: 'door'})]));

		const door = elFor(mount, 'door');

		expect(door.dataset.slidersLink).toBeUndefined();
		expect(door.dataset.slidersTarget).toBeUndefined();
		expect(door.getAttribute('tabindex')).toBeNull();
	});

	it('counts links on the root, because a link is invisible until hovered', async () => {
		const {mount, renderer} = await mounted();
		const root = mount.querySelector('.sliders-root') as HTMLElement;

		await renderer.apply(
			stage([
				entity({id: 'door', link: {to: 'Cellar'}}),
				entity({id: 'gate', link: {to: 'Alley'}}),
				entity({id: 'rock'})
			])
		);

		expect(root.dataset.linkCount).toBe('2');

		await renderer.apply(stage([entity({id: 'rock'})]));
		expect(root.dataset.linkCount).toBe('0');
	});

	it('passes a highlight token through for the story stylesheet', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(
			stage([
				entity({id: 'door', link: {to: 'X'}, highlight: 'arcane'}),
				entity({id: 'chest', link: {to: 'Y'}, highlight: '#ffcc00'})
			])
		);

		expect(elFor(mount, 'door').dataset.highlight).toBe('arcane');
		expect(elFor(mount, 'chest').dataset.highlight).toBe('#ffcc00');
		// A spelling that cannot be anything but a colour also drives the default glow.
		expect(
			elFor(mount, 'chest').style.getPropertyValue('--sliders-highlight')
		).toBe('#ffcc00');
	});
});

describe('clicking', () => {
	it('reports name, target and the event a host reads modifiers from', async () => {
		const onLink = jest.fn();
		const {mount, renderer} = await mounted(onLink);

		await renderer.apply(
			stage([entity({id: 'gate', link: {name: 'escape', to: 'Alley'}})])
		);

		elFor(mount, 'gate').dispatchEvent(
			new MouseEvent('click', {bubbles: true, ctrlKey: true})
		);

		expect(onLink).toHaveBeenCalledTimes(1);
		expect(onLink.mock.calls[0][0]).toBe('escape');
		expect(onLink.mock.calls[0][1]).toBe('Alley');
		expect(onLink.mock.calls[0][2].ctrlKey).toBe(true);
	});

	it('says nothing for a click on scenery, so the host can still advance', async () => {
		const onLink = jest.fn();
		const {mount, renderer} = await mounted(onLink);

		await renderer.apply(stage([entity({id: 'rock'})]));
		elFor(mount, 'rock').dispatchEvent(
			new MouseEvent('click', {bubbles: true})
		);

		expect(onLink).not.toHaveBeenCalled();
	});

	it('follows a link from the keyboard, carrying the same route', async () => {
		const onLink = jest.fn();
		const {mount, renderer} = await mounted(onLink);

		await renderer.apply(stage([entity({id: 'door', link: {to: 'Cellar'}})]));
		elFor(mount, 'door').dispatchEvent(
			new KeyboardEvent('keydown', {bubbles: true, key: 'Enter'})
		);

		expect(onLink).toHaveBeenCalledTimes(1);
		expect(onLink.mock.calls[0][1]).toBe('Cellar');
	});

	it('stops reporting once destroyed', async () => {
		const onLink = jest.fn();
		const {mount, renderer} = await mounted(onLink);

		await renderer.apply(stage([entity({id: 'door', link: {to: 'Cellar'}})]));

		const el = elFor(mount, 'door');

		renderer.destroy();
		el.dispatchEvent(new MouseEvent('click', {bubbles: true}));
		expect(onLink).not.toHaveBeenCalled();
	});
});
