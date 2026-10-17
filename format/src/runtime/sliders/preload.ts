/**
 * Fetch every piece of art the story names before showing anything.
 *
 * Images used to load as each scene asked for them, so a scene popped in piece by piece.
 * Now the page stays blank under a thin progress bar until every url in the manifest is
 * held locally as an object url, and the first scene is drawn and decoded behind it.
 *
 * Bytes are counted off the response stream. A response with no stream or no
 * `Content-Length` (data:, blob:) counts its manifest `bytes` when it completes.
 */

import {createLoggers} from '../logger';
import {holdUrls, manifestArt} from './assets';

const {warn} = createLoggers('scene');

const CONCURRENCY = 6;
const REVEAL_CAP_MS = 5000;
const LOADING_CLASS = 'sliders-preloading';

interface Item {
	url: string;
	mime?: string;
	expected: number;
	loaded: number;
}

function collect(): Item[] {
	const {urls, meta} = manifestArt();
	const byUrl = new Map<string, Item>();

	for (const [key, url] of Object.entries(urls)) {
		if (typeof url !== 'string' || byUrl.has(url)) {
			continue;
		}

		const found = meta(key);

		byUrl.set(url, {
			url,
			mime: found?.mime,
			expected: found?.bytes ?? 0,
			loaded: 0
		});
	}

	return [...byUrl.values()];
}

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

async function fetchLocal(item: Item, progress: () => void): Promise<string> {
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

async function fetchAll(
	items: Item[],
	progress: () => void
): Promise<Map<string, string>> {
	const local = new Map<string, string>();
	const queue = [...items];

	async function worker() {
		for (let item = queue.shift(); item; item = queue.shift()) {
			try {
				local.set(item.url, await fetchLocal(item, progress));
			} catch (error) {
				warn(
					`Could not preload ${item.url}, it will load when shown. (${
						(error as Error).message
					})`
				);
			}

			item.loaded = item.expected;
			progress();
		}
	}

	await Promise.all(Array.from({length: CONCURRENCY}, worker));
	return local;
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

/** Called once per page load, after the manifests are reset and before any stage mounts. */
export function preloadArt(): void {
	const items = collect();

	if (items.length === 0) {
		return;
	}

	const bar = mountBar();
	const progress = () =>
		bar.update(
			items.reduce((sum, item) => sum + item.loaded, 0),
			items.reduce((sum, item) => sum + item.expected, 0)
		);

	progress();
	void holdUrls(fetchAll(items, progress))
		.then(firstSceneDrawn)
		.finally(() => bar.remove());
}
