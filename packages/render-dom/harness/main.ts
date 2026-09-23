/**
 * Standalone harness for `render-dom`. No Twine, no asset store, no build step:
 *
 *   npx vite packages/render-dom/harness --port 5199
 *
 * Three hardcoded stages exercise every path the renderer has — enter, exit, move, flip,
 * pose swap, depth change, camera pan + zoom, fx, a missing asset, bubbles with links and a
 * narration box.
 */

import type {Stage, StageEntity, Transition} from '@sliders/scene-types';
import {DialogueLayer, DomRenderer, createStubResolver} from '../src/index';

// The stage `y` an entity stands on. scene-core resolves the real stage baseline; the
// renderer is handed absolute coordinates and does not invent one.
const FLOOR = -0.85;

function cast(
	id: string,
	at: {x: number; y?: number},
	patch: Partial<StageEntity> = {}
): StageEntity {
	return {
		id,
		kind: 'cast',
		ref: id,
		at: {x: at.x, y: at.y ?? FLOOR},
		pose: 'idle',
		flip: false,
		opacity: 1,
		scale: 1,
		...patch
	};
}

function prop(
	id: string,
	ref: string,
	at: {x: number; y?: number},
	patch: Partial<StageEntity> = {}
): StageEntity {
	return {
		id,
		kind: 'prop',
		ref,
		at: {x: at.x, y: at.y ?? FLOOR},
		flip: false,
		opacity: 1,
		scale: 1,
		...patch
	};
}

function stageOf(
	entities: StageEntity[],
	patch: Partial<Stage> = {}
): Stage {
	return {
		bg: 'bg_tavern_night',
		camera: {at: {x: 0, y: 0}, zoom: 1},
		entities: Object.fromEntries(entities.map(e => [e.id, e])),
		fx: [],
		...patch
	};
}

interface Step {
	title: string;
	stage: Stage;
	transitions: Transition[];
	bubbles: {who: string; name: string; text: string}[];
	box: string | null;
}

const STEPS: Step[] = [
	{
		title: 'Arrival — mira alone, candle on the table',
		stage: stageOf([
			cast('mira', {x: -0.4}, {pose: 'arms-crossed'}),
			prop('table', 'obj_table', {x: 0.15}),
			prop('candle', 'obj_candle', {x: 0.15, y: -0.55}, {z: 2})
		]),
		transitions: [
			{kind: 'bg', duration: 0.4},
			{kind: 'enter', duration: 0.45}
		],
		bubbles: [
			{
				who: 'mira',
				name: 'Mira',
				text: "You shouldn't have come back."
			}
		],
		box: null
	},
	{
		title: 'Joren enters behind her, flipped, behind everything',
		stage: stageOf([
			cast('mira', {x: -0.25}, {pose: 'angry'}),
			cast('joren', {x: 0.45, y: -0.78}, {flip: true, z: -1}),
			prop('table', 'obj_table', {x: 0.15}),
			prop('candle', 'obj_candle', {x: 0.15, y: -0.55}, {z: 2})
		]),
		transitions: [
			{kind: 'enter', entityId: 'joren', duration: 0.5},
			{kind: 'move', duration: 0.5},
			{kind: 'pose', duration: 0.3}
		],
		bubbles: [
			{who: 'mira', name: 'Mira', text: 'Get out.'},
			{who: 'joren', name: 'Joren', text: 'And yet.'}
		],
		box: null
	},
	{
		title: 'Camera pushes in, candle gutters, one asset deliberately missing',
		stage: stageOf(
			[
				cast('mira', {x: -0.1}, {pose: 'wave'}),
				cast('joren', {x: 0.3}, {pose: 'angry'}),
				prop('table', 'obj_table', {x: 0.15}),
				prop('ghost', 'obj_missing_thing', {x: 0.75, y: -0.6}, {z: 2})
			],
			{
				camera: {at: {x: 0.05, y: -0.1}, zoom: 1.2},
				fx: [{id: 'cold', amount: 0.45}]
			}
		),
		transitions: [
			{kind: 'exit', entityId: 'candle', duration: 0.35},
			{kind: 'enter', duration: 0.4},
			{kind: 'move', duration: 0.6},
			{kind: 'camera', duration: 0.7},
			{kind: 'pose', duration: 0.25}
		],
		bubbles: [
			{
				who: 'mira',
				name: 'Mira',
				text: 'Will you [[stay]] or [[go -> Street]]?'
			}
		],
		box: 'The candle gutters. Something in the corner does not resolve.'
	},
	{
		title: 'Mira walks the cycle, Joren blinks once and holds',
		stage: stageOf([
			// A cycle that also travels: each step names its own `at`, so the sprite glides
			// across the stage while the poses swap under it.
			cast('mira', {x: -0.6}, {
				steps: [
					{name: 'idle', dur: 0.25, at: {x: -0.6, y: FLOOR}},
					{name: 'wave', dur: 0.25, at: {x: 0, y: FLOOR}},
					{name: 'angry', dur: 0.25, at: {x: 0.6, y: FLOOR}}
				]
			}),
			// A cycle in place, played through once.
			cast('joren', {x: 0.4}, {
				poseLoop: 'once',
				steps: [
					{name: 'idle', dur: 0.4},
					{name: 'angry'}
				]
			}),
			prop('table', 'obj_table', {x: 0.15})
		]),
		transitions: [{kind: 'enter', duration: 0.4}],
		bubbles: [],
		box: 'Pose steps run on the renderer\'s own clock, not the beat\'s.'
	},
	{
		title: 'Two fit: planes with the cast sandwiched between them',
		stage: stageOf([
			// Backmost: a plane fills the stage and takes no sprite geometry at all.
			prop('sky', 'plane_sky', {x: 0}, {fit: 'cover', z: -2}),
			cast('mira', {x: -0.35}),
			cast('joren', {x: 0.3}, {flip: true}),
			prop('table', 'obj_table', {x: 0.15}),
			// In FRONT of the cast, which is the thing `bg:` cannot do. Half transparent
			// here only because the stub resolver draws solid rectangles.
			prop('haze', 'plane_haze', {x: 0}, {fit: 'cover', z: 3, opacity: 0.45})
		]),
		transitions: [{kind: 'enter', duration: 0.4}],
		bubbles: [],
		box: 'fit: cover — a backdrop INSIDE the entity stack, so z: puts art in front of the cast.'
	}
];

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

const host = document.getElementById('stage') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const labelEl = document.getElementById('label') as HTMLElement;

const assets = createStubResolver({
	// The one id that must NOT resolve, so the labelled placeholder path is on screen.
	missing: ['obj_missing_thing'],
	assets: {
		obj_table: {w: 900, h: 300, color: '#6b4a2f'},
		obj_candle: {w: 90, h: 260, color: '#ffd88a'},
		bg_tavern_night: {w: 1920, h: 1080, kind: 'bg', color: '#243043'},
		// Deliberately the wrong aspect for the stage: a plane is object-fit: cover, so it
		// has to fill anyway.
		plane_sky: {w: 800, h: 1200, kind: 'bg', color: '#1d3a5f'},
		plane_haze: {w: 1920, h: 1080, kind: 'bg', color: '#ff9a3c'}
	}
});

const renderer = new DomRenderer({guides: false});
const dialogue = new DialogueLayer({
	onLink(name, target) {
		statusEl.innerHTML = `link clicked: <b>${name}</b>${
			target && target !== name ? ` &rarr; ${target}` : ''
		}`;
	}
});

let index = 0;
let snap = false;

async function show(next: number, animate = true): Promise<void> {
	index = (next + STEPS.length) % STEPS.length;

	const step = STEPS[index];

	labelEl.textContent = `${index + 1} / ${STEPS.length} — ${step.title}`;

	await renderer.apply(
		step.stage,
		animate && !snap ? step.transitions : []
	);

	dialogue.setBubbles(step.bubbles);
	dialogue.setBox(step.box);
}

function button(id: string): HTMLButtonElement {
	return document.getElementById(id) as HTMLButtonElement;
}

async function main(): Promise<void> {
	await renderer.mount(host, assets);
	dialogue.mount(host, renderer);

	button('next').addEventListener('click', () => void show(index + 1));
	button('prev').addEventListener('click', () => void show(index - 1));
	button('replay').addEventListener('click', () => void show(index));

	button('guides').addEventListener('click', event => {
		const el = event.currentTarget as HTMLButtonElement;
		const on = el.getAttribute('aria-pressed') !== 'true';

		el.setAttribute('aria-pressed', String(on));
		renderer.setGuides(on);
	});

	button('snap').addEventListener('click', event => {
		const el = event.currentTarget as HTMLButtonElement;

		snap = el.getAttribute('aria-pressed') !== 'true';
		el.setAttribute('aria-pressed', String(snap));
	});

	window.addEventListener('keydown', event => {
		if (event.key === 'ArrowRight') {
			void show(index + 1);
		} else if (event.key === 'ArrowLeft') {
			void show(index - 1);
		}
	});

	// Handles for poking at the renderer from the devtools console or from Playwright.
	(window as unknown as Record<string, unknown>).slidersHarness = {
		renderer,
		dialogue,
		assets,
		steps: STEPS,
		show,
		stageOf,
		cast,
		prop
	};

	// First paint has nothing to transition from.
	await show(0, false);
	statusEl.textContent =
		'Step through the stages to see enter / exit / move / flip / camera transitions.';
}

void main();
