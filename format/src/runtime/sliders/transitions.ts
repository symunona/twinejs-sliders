/**
 * Scene transitions: how the next passage arrives.
 *
 * Chapbook's `<page-transition>` hands its whole passage swap to `startSlidersTransition`
 * (see format/README.md). Precedence, first wins:
 *
 * 1. the clicked link's own `transition:`
 * 2. the leaving scene's `linkList: {transition:}`
 * 3. the destination scene's top-level `transition:`
 * 4. the story's `config.body.transition.name` / `.duration` / `.ease`
 * 5. fade, 300ms
 *
 * 1–2 are known at the click (`setLinkTransition`), 3 while the passage renders
 * (`noteSceneTransition`), and both are consumed by the swap. A destination with `from:`
 * and none of 1–3 CUTS: the inherited stage's own diff animation is the transition.
 *
 * Module scope, never story state: a pending transition must not persist into a save.
 */

import {
	defaultTransitionEase,
	parseSceneTransition,
	reverseSceneTransition,
	SCENE_TRANSITION_MAX_DUR,
	EASES,
	transitionEaseValue,
	type SceneTransitionKind
} from '@sliders/scene-types';
import timestring from 'timestring';
import {createLoggers} from '../logger';
import {get} from '../state';
import {currentPassage, resumeAtEnd} from './history';

const {warn} = createLoggers('scene');

/**
 * `document.startViewTransition`, which the DOM lib ts-jest compiles against does not know
 * yet — same gap as `ActivationNavigator` in `stage-element.ts`.
 */
interface ViewTransitionDocument {
	startViewTransition?: (update: () => Promise<void>) => {finished: Promise<void>};
}

/** Longest the swap waits for the new `<sliders-stage>` to draw before snapshotting. */
const READY_CAP_MS = 800;

export interface ResolvedTransition {
	kind: SceneTransitionKind;
	/** Seconds, clamped. */
	dur: number;
	/** CSS timing function. */
	ease: string;
}

let pendingLink: string | undefined;
let destination: {spec?: string; from: boolean} | undefined;
/** How the reader arrived at each trail depth — reversed when they step back out of it. */
const arrivedWith: (ResolvedTransition | undefined)[] = [];
let sequence = 0;

/** A link was clicked: its own `transition:`, else its list's default. */
export function setLinkTransition(spec: string | undefined): void {
	pendingLink = spec;
}

/** The `[scene]` modifier, rendering the destination. First scene in the passage wins. */
export function noteSceneTransition(spec: string | undefined, from: boolean): void {
	if (!destination) {
		destination = {from, spec};
	}
}

function storySeconds(): number | undefined {
	const raw = get('config.body.transition.duration');

	if (typeof raw === 'number') {
		return raw;
	}

	if (typeof raw === 'string' && raw.trim() !== '') {
		try {
			return timestring(raw, 's');
		} catch {
			return undefined;
		}
	}

	return undefined;
}

function storyEase(): string | undefined {
	const raw = get('config.body.transition.ease');

	return typeof raw === 'string' ? transitionEaseValue(raw.trim()) : undefined;
}

function finish(
	kind: SceneTransitionKind,
	dur: number | undefined,
	ease: string | undefined
): ResolvedTransition {
	const seconds = Math.min(
		SCENE_TRANSITION_MAX_DUR,
		Math.max(0, dur ?? storySeconds() ?? 0.3)
	);

	return {
		dur: seconds,
		ease: ease ?? storyEase() ?? defaultTransitionEase(kind),
		kind: seconds === 0 ? 'cut' : kind
	};
}

/** Precedence 1–5, forward navigation. */
function resolveForward(): ResolvedTransition {
	for (const spec of [pendingLink, destination?.spec]) {
		const parsed = spec ? parseSceneTransition(spec).transition : undefined;

		if (parsed) {
			return finish(parsed.kind, parsed.dur, parsed.ease);
		}
	}

	if (destination?.from) {
		return {dur: 0, ease: EASES.linear, kind: 'cut'};
	}

	const story = parseSceneTransition(get('config.body.transition.name'))
		.transition;

	return finish(story?.kind ?? 'fade', story?.dur, story?.ease);
}

function trailDepth(): number {
	const trail = get('trail');

	return Array.isArray(trail) ? trail.length : 0;
}

/** Work out this swap's transition and forget what was pending. */
export function takePageTransition(): ResolvedTransition {
	const depth = trailDepth();
	let resolved: ResolvedTransition;

	if (resumeAtEnd(currentPassage())) {
		// Stepping BACK: undo the move that brought the reader to the passage they leave.
		const came = arrivedWith[depth + 1] ?? resolveForward();

		resolved = {...came, kind: reverseSceneTransition(came.kind)};
	} else {
		resolved = resolveForward();
		arrivedWith[depth] = resolved;
	}

	arrivedWith.length = depth + 1;
	pendingLink = undefined;
	destination = undefined;

	if (
		resolved.kind !== 'cut' &&
		window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
	) {
		resolved = {...resolved, kind: 'fade'};
	}

	return resolved;
}

/** Wait for every new `<sliders-stage>` under `root` to draw its opening picture, capped. */
async function stagesReady(root: Element): Promise<void> {
	const stages = Array.from(root.querySelectorAll('sliders-stage'));

	if (stages.length === 0) {
		return;
	}

	let timer: number | undefined;
	const capped = await Promise.race([
		Promise.all(
			stages.map(stage => (stage as {ready?: Promise<void>}).ready)
		).then(() => false),
		new Promise<boolean>(resolve => {
			timer = window.setTimeout(() => resolve(true), READY_CAP_MS);
		})
	]);

	window.clearTimeout(timer);

	if (capped) {
		warn(
			`Scene transition went ahead before the new stage was drawn (${READY_CAP_MS}ms).`
		);
	}
}

/**
 * Chapbook's passage swap, with a scene transition around it.
 *
 * The update callback waits for the new stage to be drawn, or the view transition's "new"
 * snapshot is an empty box and the page flickers. No View Transitions API, or a cut: swap
 * straight away, as Chapbook always did.
 */
export async function startSlidersTransition(
	host: HTMLElement,
	callback: () => void | Promise<void>,
	preserveWindowScroll = false
): Promise<void> {
	const {dur, ease, kind} = takePageTransition();
	const swap = async () => {
		await callback();

		if (!preserveWindowScroll) {
			window.scrollTo(0, 0);
		}
	};

	const start = (document as ViewTransitionDocument).startViewTransition;

	if (!start || kind === 'cut') {
		await swap();
		return;
	}

	const root = document.documentElement;
	const token = ++sequence;

	root.setAttribute('data-sliders-transition', kind);
	root.style.setProperty('--page-transition-duration', `${dur}s`);
	root.style.setProperty('--page-transition-ease', ease);

	const transition = start.call(document, async () => {
		await swap();
		await stagesReady(host);
	});

	try {
		// Rejects only when the swap itself threw; that error has already been reported.
		await transition.finished.catch(() => undefined);
	} finally {
		// A newer swap may have started meanwhile; its attribute is not ours to clear.
		if (token === sequence) {
			root.removeAttribute('data-sliders-transition');
		}
	}
}
