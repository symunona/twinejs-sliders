/**
 * Standalone harness for `render-dom`. No Twine, no asset store, no build step:
 *
 *   npx vite packages/render-dom/harness --port 5199
 *
 * Three hardcoded stages exercise every path the renderer has — enter, exit, move, flip,
 * frame swap, layer change, camera pan + zoom, fx, a missing asset, bubbles with links and a
 * narration box.
 */

import type {Stage, StageEntity, Transition} from '@sliders/scene-types';
import {DialogueLayer, DomRenderer, createStubResolver} from '../src/index';

// The stage `y` an entity stands on. scene-core resolves the real layer baseline; the
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
		frame: 'idle',
		flip: false,
		layer: 'mid',
		opacity: 1,
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
		layer: 'mid',
		opacity: 1,
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
			cast('mira', {x: -0.4}, {frame: 'arms-crossed'}),
			prop('table', 'obj_table', {x: 0.15}),
			prop('candle', 'obj_candle', {x: 0.15, y: -0.55}, {layer: 'front'})
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
		title: 'Joren enters behind her, flipped, on the back layer',
		stage: stageOf([
			cast('mira', {x: -0.25}, {frame: 'angry'}),
			cast('joren', {x: 0.45, y: -0.78}, {flip: true, layer: 'back'}),
			prop('table', 'obj_table', {x: 0.15}),
			prop('candle', 'obj_candle', {x: 0.15, y: -0.55}, {layer: 'front'})
		]),
		transitions: [
			{kind: 'enter', entityId: 'joren', duration: 0.5},
			{kind: 'move', duration: 0.5},
			{kind: 'frame', duration: 0.3}
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
				cast('mira', {x: -0.1}, {frame: 'wave'}),
				cast('joren', {x: 0.3}, {layer: 'mid', frame: 'angry'}),
				prop('table', 'obj_table', {x: 0.15}),
				prop('ghost', 'obj_missing_thing', {x: 0.75, y: -0.6}, {layer: 'front'})
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
			{kind: 'frame', duration: 0.25}
		],
		bubbles: [
			{
				who: 'mira',
				name: 'Mira',
				text: 'Will you [[stay]] or [[go -> Street]]?'
			}
		],
		box: 'The candle gutters. Something in the corner does not resolve.'
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
		bg_tavern_night: {w: 1920, h: 1080, kind: 'bg', color: '#243043'}
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
