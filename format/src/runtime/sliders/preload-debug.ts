/**
 * The preload debugger. Off unless `localStorage['sliders.preload.debug']` is set.
 *
 * On: every loader event goes to the console as `[preload] +123ms …`, and a panel in the
 * bottom right lists each asset (tier, state, timing, size, passages, what made it urgent)
 * above the event log. `sliders.preload.delay` = ms adds a fake delay to every download,
 * to watch the order and to reach the navigation stop on a fast connection.
 *
 * Toggle, in the player's console:
 *
 *   localStorage.getItem('sliders.preload.debug')?localStorage.removeItem('sliders.preload.debug'):localStorage.setItem('sliders.preload.debug','1');location.reload()
 */

import type {AssetLoader, LoaderEntry, LoaderEvent} from './asset-loader';
import {kb} from './asset-loader';

export const DEBUG_KEY = 'sliders.preload.debug';
export const DELAY_KEY = 'sliders.preload.delay';

function read(key: string): string | null {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

export function preloadDebugOn(): boolean {
	const value = read(DEBUG_KEY);

	return value !== null && value !== '' && value !== '0';
}

/** Fake per-download delay in ms, debug only. */
export function preloadDelay(): number {
	const ms = Number(read(DELAY_KEY));

	return preloadDebugOn() && ms > 0 ? ms : 0;
}

export function describeEvent(event: LoaderEvent): string {
	const tier = event.tier === undefined ? '' : ` t${event.tier}`;
	const label = event.label ? ` ${event.label}` : '';
	const detail = event.detail ? ` — ${event.detail}` : '';

	return `+${event.t}ms ${event.type}${tier}${label}${detail}`;
}

const STATE_MARK: Record<LoaderEntry['state'], string> = {
	done: '✓',
	failed: '✗',
	loading: '…',
	queued: '·'
};

function row(entry: LoaderEntry): string {
	const time =
		entry.startedAt === undefined
			? ''
			: entry.endedAt === undefined
			? `@${entry.startedAt}`
			: `@${entry.startedAt} ${entry.endedAt - entry.startedAt}ms`;
	const urgent = entry.urgentBy ? ` ⚡${entry.urgentBy}` : '';

	return `${STATE_MARK[entry.state]} t${entry.tier} ${entry.label} ${kb(
		entry.loaded || entry.expected
	)} ${time}${urgent} [${entry.passages.join(', ')}]`;
}

export function mountPreloadDebug(loader: AssetLoader): void {
	const log = (event: LoaderEvent) =>
		console.info(`[preload] ${describeEvent(event)}`);

	loader.events.forEach(log);
	loader.subscribe(log);

	const panel = document.createElement('div');
	const head = document.createElement('div');
	const toggle = document.createElement('button');
	const assets = document.createElement('pre');
	const events = document.createElement('pre');

	panel.className = 'sliders-preload-debug';
	panel.setAttribute('aria-label', 'Preload debugger');
	toggle.type = 'button';
	toggle.textContent = '–';
	toggle.title = 'Collapse';
	toggle.addEventListener('click', () => {
		panel.classList.toggle('sliders-preload-debug--collapsed');
	});
	head.className = 'sliders-preload-debug__head';
	assets.className = 'sliders-preload-debug__assets';
	events.className = 'sliders-preload-debug__events';
	panel.append(head, assets, events);
	head.append(toggle, document.createElement('span'));

	let queued = false;
	const draw = () => {
		queued = false;

		const list = [...loader.entries.values()].sort(
			(a, b) => a.tier - b.tier || a.order - b.order
		);
		const count = (state: LoaderEntry['state']) =>
			list.filter(e => e.state === state).length;

		(head.lastChild as HTMLElement).textContent = ` preload: ${count(
			'done'
		)}/${list.length} done, ${count('loading')} loading, ${count(
			'failed'
		)} failed · open ≤ ${loader.openTier}`;
		assets.textContent = list.map(row).join('\n');
		events.textContent = loader.events
			.slice(-200)
			.map(describeEvent)
			.reverse()
			.join('\n');
	};
	const schedule = () => {
		if (!queued) {
			queued = true;
			requestAnimationFrame(draw);
		}
	};

	loader.subscribe(schedule);
	schedule();
	document.body.append(panel);
}
