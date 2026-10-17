/**
 * Download the story's art in priority order, and keep the reader from outrunning it.
 *
 * 1. The page stays hidden under a thin progress bar while the art of the passage the
 *    reader opens on (tier 0 of `preload-plan.ts`) downloads, and its scene draws and
 *    decodes behind the bar.
 * 2. Then the page shows and every other tier downloads in the background, nearest
 *    passages first (`asset-loader.ts`).
 * 3. A stage asking for a url the queue has not reached moves it to the front.
 * 4. A click towards a passage whose art is not down yet waits for it: every link is
 *    blocked, the clicked one shows a spinner, and the click goes through once the art
 *    is local (or after `NAV_CAP_MS`, whatever arrived).
 *
 * Every url is held as an object url once down, so a scene never pops in piece by piece.
 * Bytes are counted off the response stream; a response with no `Content-Length` (data:,
 * blob:) counts its manifest `bytes` when it completes.
 *
 * Debugger: `preload-debug.ts`.
 */

import {createLoggers} from '../logger';
import {passageNamed, passages} from '../story';
import {manifestArt, routeUrls} from './assets';
import {AssetLoader} from './asset-loader';
import {probeAutoplay} from './autoplay';
import type {LoaderEntry} from './asset-loader';
import {currentPassage} from './history';
import {buildPreloadPlan} from './preload-plan';
import type {PreloadPlan} from './preload-plan';
import {mountPreloadDebug, preloadDebugOn, preloadDelay} from './preload-debug';
import {sceneOf} from './scene-graph';

const {warn} = createLoggers('scene');

const CONCURRENCY = 6;
const REVEAL_CAP_MS = 5000;
/** Longest a click waits for its destination's art before going anyway. */
export const NAV_CAP_MS = 20000;
const LOADING_CLASS = 'sliders-preloading';
const NAV_WAIT_CLASS = 'sliders-nav-wait';
const LINK_LOADING_CLASS = 'sliders-link-loading';
/** A click this recent is the one a stage link handler is answering. */
const PRESS_FRESH_MS = 1000;

let loader: AssetLoader | undefined;
let plan: PreloadPlan | undefined;
let waiting = false;
let pressed: {el: HTMLElement; at: number} | undefined;
let bypass: Element | undefined;
let revealed: Promise<void> = Promise.resolve();
let soundAllowed = false;

function megabytes(bytes: number): string {
	return `${(bytes / 1e6).toFixed(1)} MB`;
}

function mountBar() {
	const root = document.createElement('div');
	const fill = document.createElement('div');
	const label = document.createElement('div');

	root.className = 'sliders-preload';
	root.setAttribute('role', 'progressbar');
	root.setAttribute('aria-valuemin', '0');
	root.setAttribute('aria-valuemax', '100');
	fill.className = 'sliders-preload__fill';
	label.className = 'sliders-preload__label';
	root.append(fill, label);
	document.body.append(root);
	document.documentElement.classList.add(LOADING_CLASS);

	return {
		update(loaded: number, total: number) {
			const shown = Math.min(loaded, total);
			const percent = total > 0 ? Math.floor((shown / total) * 100) : 0;

			fill.style.width = `${percent}%`;
			label.textContent = `${megabytes(shown)} / ${megabytes(
				total
			)} · ${percent}%`;
			root.setAttribute('aria-valuenow', String(percent));
		},
		remove() {
			document.documentElement.classList.remove(LOADING_CLASS);
			root.remove();
		}
	};
}

/**
 * The boot screen: the opening scene has sound and the browser will not play it until the
 * reader interacts. Shown over the bar while the art loads; its button arms once the
 * scene is ready, and that click is the gesture the sound deck needs.
 */
function mountBoot() {
	const root = document.createElement('div');
	const button = document.createElement('button');
	let release!: () => void;
	const clicked = new Promise<void>(resolve => (release = resolve));

	root.className = 'sliders-boot';
	button.type = 'button';
	button.className = 'sliders-boot__play';
	button.disabled = true;
	button.textContent = 'Loading…';
	button.setAttribute('aria-busy', 'true');
	button.addEventListener('click', () => release());
	root.append(button);
	document.body.append(root);

	return {
		clicked,
		arm() {
			button.disabled = false;
			button.textContent = '▶ Play';
			button.removeAttribute('aria-busy');
			button.focus();
		},
		remove() {
			root.remove();
		}
	};
}

/**
 * Settles when the page is shown — the bar gone and, when it was needed, the boot screen
 * clicked. A stage starts its beats only then, or a timed beat runs out unseen.
 */
export function whenRevealed(): Promise<void> {
	return revealed;
}

/** The browser plays sound without a gesture (kiosk, allow-listed site, earlier click). */
export function autoplayAllowed(): boolean {
	return soundAllowed;
}

function wait(ms: number): Promise<void> {
	return new Promise(resolve => window.setTimeout(resolve, ms));
}

/** The real download: the url's bytes into an object url. */
export async function fetchLocal(
	item: LoaderEntry,
	progress: () => void
): Promise<string> {
	const delay = preloadDelay();

	if (delay > 0) {
		await wait(delay);
	}

	const response = await fetch(item.url);

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}

	const length = Number(response.headers.get('content-length'));
	const type =
		item.mime || response.headers.get('content-type') || undefined;

	if (length > 0) {
		item.expected = length;
		progress();
	}

	let blob: Blob;

	if (response.body && length > 0) {
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];

		for (;;) {
			const {done, value} = await reader.read();

			if (done) {
				break;
			}

			chunks.push(value);
			item.loaded += value.byteLength;
			progress();
		}

		blob = new Blob(chunks, {type});
	} else {
		blob = new Blob([await response.arrayBuffer()], {type});
	}

	return URL.createObjectURL(blob);
}

function nextFrame(): Promise<void> {
	return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

/** The first scene drawn, its pictures decoded — or the cap, whichever comes first. */
async function firstSceneDrawn(): Promise<void> {
	await nextFrame();

	const stages = Array.from(document.querySelectorAll('sliders-stage'));
	const drawn = Promise.all(
		stages.map(stage => (stage as {ready?: Promise<void>}).ready)
	).then(() =>
		Promise.all(
			stages.flatMap(stage =>
				Array.from(stage.querySelectorAll('img'), img =>
					img.decode().catch(() => undefined)
				)
			)
		)
	);
	let timer: number | undefined;

	await Promise.race([
		drawn,
		new Promise(resolve => {
			timer = window.setTimeout(resolve, REVEAL_CAP_MS);
		})
	]);
	window.clearTimeout(timer);
	await nextFrame();
}

/** True while the page is still hidden behind the preload bar. */
export function preloading(): boolean {
	return document.documentElement.classList.contains(LOADING_CLASS);
}

/** The urls a passage's scene draws that are not down yet. Empty before the plan. */
export function pendingFor(passage: string): string[] {
	const name = passageNamed(passage)?.name ?? passage;
	const urls = plan?.byPassage.get(name) ?? [];

	return loader ? urls.filter(url => !loader!.isSettled(url)) : [];
}

/**
 * Hold the reader at the link they clicked until `to`'s art is down. Every link is
 * blocked meanwhile (`onClickCapture`), and `el` wears a spinner.
 */
async function hold(to: string, urls: string[], el?: HTMLElement): Promise<void> {
	const root = document.documentElement;

	waiting = true;
	root.classList.add(NAV_WAIT_CLASS);
	el?.classList.add(LINK_LOADING_CLASS);
	el?.setAttribute('aria-busy', 'true');
	loader?.emit({detail: `${to}: ${urls.length} assets pending`, type: 'nav-wait'});

	let timer: number | undefined;

	try {
		await Promise.race([
			Promise.all(urls.map(url => loader!.need(url, `click ${to}`))),
			new Promise(resolve => {
				timer = window.setTimeout(resolve, NAV_CAP_MS);
			})
		]);
	} finally {
		window.clearTimeout(timer);
		waiting = false;
		root.classList.remove(NAV_WAIT_CLASS);
		el?.classList.remove(LINK_LOADING_CLASS);
		el?.removeAttribute('aria-busy');
		loader?.emit({detail: to, type: 'nav-go'});
	}
}

/**
 * The stage's own links (bubbles, entities, the in-stage list) go through here. `go`
 * runs now when the art is down, after the wait when not, never while another wait runs.
 */
export function navigateWhenReady(to: string, go: () => void): void {
	if (waiting) {
		return;
	}

	const urls = pendingFor(to);

	if (urls.length === 0) {
		go();
		return;
	}

	const fresh =
		pressed && performance.now() - pressed.at < PRESS_FRESH_MS
			? pressed.el
			: undefined;

	void hold(to, urls, fresh).then(go);
}

/**
 * Capture phase on the document, so it runs before any link's own handler: Chapbook's
 * `<passage-link>` calls `go()` in its own click listener and never asks anybody.
 */
function onClickCapture(event: MouseEvent): void {
	const target = event.target as Element | null;

	if (!target || target.closest('.sliders-preload-debug')) {
		return;
	}

	if (waiting) {
		event.stopImmediatePropagation();
		event.preventDefault();
		loader?.emit({type: 'nav-blocked'});
		return;
	}

	pressed = {
		at: performance.now(),
		el: (target.closest(
			'passage-link, button, a, [role="button"], [role="link"]'
		) ?? target) as HTMLElement
	};

	const link = target.closest('passage-link');
	const to = link?.getAttribute('to');

	if (!link || !to || link === bypass) {
		return;
	}

	const urls = pendingFor(to);

	if (urls.length === 0) {
		return;
	}

	event.stopImmediatePropagation();
	event.preventDefault();
	void hold(to, urls, link as HTMLElement).then(() => {
		bypass = link;

		try {
			(link as HTMLElement).click();
		} finally {
			bypass = undefined;
		}
	});
}

async function plan0(): Promise<PreloadPlan> {
	const {assets, characters, urls} = manifestArt();

	return buildPreloadPlan({
		assets,
		characters,
		passages: passages()
			.filter(passage => passage.name)
			.map(passage => ({name: passage.name!, text: passage.source})),
		scenes: sceneOf,
		start: currentPassage(),
		urls
	});
}

async function run(bar: ReturnType<typeof mountBar>): Promise<void> {
	// After `init()` has finished: a save restored from storage moves the trail, and the
	// passage it lands on is tier 0.
	await Promise.resolve();
	plan = await plan0();

	for (const tier of plan.tiers) {
		for (const asset of tier.assets) {
			loader!.add(asset.url, {
				bytes: asset.bytes,
				label: asset.label,
				mime: asset.mime,
				tier: tier.depth
			});
		}
	}

	for (const [passage, urls] of plan.byPassage) {
		for (const url of urls) {
			const entry = loader!.entries.get(url);

			if (entry && !entry.passages.includes(passage)) {
				entry.passages.push(passage);
			}
		}
	}

	loader!.emit({
		detail: `start "${plan.start}", ${plan.tiers
			.map(t => `t${t.depth}${t.unreached ? '(unreached)' : ''}: ${t.passages.length}p/${t.assets.length}a`)
			.join(', ')}`,
		type: 'plan'
	});

	const first = plan.tiers[0]?.assets.map(a => a.url) ?? [];
	const sound = plan.sound.has(plan.start);
	const boot = sound ? mountBoot() : undefined;
	const verdict = sound ? probeAutoplay() : undefined;

	await loader!.allSettled(first);
	await firstSceneDrawn();

	if (verdict) {
		const {answer, via} = await verdict;

		soundAllowed = answer === 'allowed';
		loader!.emit({detail: `${answer} (${via})`, type: 'autoplay'});

		if (!soundAllowed) {
			loader!.emit({type: 'boot-wait'});
			boot!.arm();
			await boot!.clicked;
			loader!.emit({type: 'boot-click'});
		}
	}

	boot?.remove();
	bar.remove();
	loader!.emit({type: 'reveal'});
	loader!.open(Infinity);
}

/** Called once per page load, after the manifests are reset and before any stage mounts. */
export function preloadArt(): void {
	const {urls} = manifestArt();

	loader = undefined;
	plan = undefined;
	soundAllowed = false;
	revealed = Promise.resolve();

	if (Object.keys(urls).length === 0) {
		return;
	}

	const current = new AssetLoader({concurrency: CONCURRENCY, fetch: fetchLocal});

	loader = current;
	(window as {slidersPreload?: unknown}).slidersPreload = {
		loader: current,
		get plan() {
			return plan;
		}
	};

	current.subscribe(event => {
		if (event.type === 'fail') {
			warn(`Could not preload ${event.url}, it will load when shown. (${event.detail})`);
		}
	});
	routeUrls((url, key) => current.need(url, `render ${key}`));
	document.removeEventListener('click', onClickCapture, true);
	document.addEventListener('click', onClickCapture, true);

	if (preloadDebugOn()) {
		mountPreloadDebug(current);
	}

	const bar = mountBar();
	const progress = () => {
		if (!preloading()) {
			return;
		}

		// The bar is the opening scene's art: tier 0, plus whatever a stage asked for.
		const shown = [...current.entries.values()].filter(
			entry => entry.tier === 0 || entry.urgent !== undefined
		);

		bar.update(
			shown.reduce((sum, entry) => sum + entry.loaded, 0),
			shown.reduce((sum, entry) => sum + entry.expected, 0)
		);
	};

	current.progress = progress;
	progress();
	revealed = run(bar).catch(error => {
		warn(`Preload stopped: ${(error as Error).message}. Art loads as it is shown.`);
		document.querySelector('.sliders-boot')?.remove();
		bar.remove();
		current.open(Infinity);
	});
}
