/**
 * The test bar: a small chip in the corner of a test play, in place of Chapbook's
 * `<warning-list>` banner.
 *
 * Chapbook shows every `console.warn` of the current passage as a yellow banner across the
 * top of the page. In a cinema scene that banner sits ON the stage, and a "Test from here"
 * opened under it before the author saw a single beat. Here the same warnings collapse to a
 * count — `⚠ 3` — that opens into the list on a click and closes again. Nothing is
 * dropped: every message still reaches the console and the list.
 *
 * Next to it, Restart: fresh state, same start. `restart()` resets state and reloads, and a
 * test play never restores from storage (`runtime/index.ts`), so the reload replays the
 * passage (and beat) under test with only the story's own vars set — the quickest way to
 * undo whatever the last run did to the variables. The cinema scene hides Chapbook's footer,
 * which is where its own Restart lives, so without this there was none.
 *
 * Test mode only (`config.testing`). A normal play gets nothing, and the vendored
 * `<warning-list>` stays where it is — it shows nothing outside test mode anyway.
 *
 * Errors are not here: `<error-handler>` still takes the page, as it should.
 */

import {restart} from '../actions';
import {get} from '../state';

const MAX_SHOWN = 50;

interface Entry {
	message: string;
	count: number;
}

let originalWarn: typeof console.warn | undefined;
let root: HTMLElement | undefined;
let entries: Entry[] = [];
let open = false;

function text(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}

	if (value instanceof Error) {
		return value.message;
	}

	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

/** Repeats fold into one line with a count: a looping beat must not grow the list. */
function addWarning(message: string): void {
	const existing = entries.find(entry => entry.message === message);

	if (existing) {
		existing.count++;
	} else {
		entries.push({count: 1, message});
	}

	update();
}

function update(): void {
	if (!root) {
		return;
	}

	const total = entries.reduce((sum, entry) => sum + entry.count, 0);
	const toggle = root.querySelector<HTMLButtonElement>(
		'.sliders-test-bar__warnings'
	)!;
	const list = root.querySelector<HTMLElement>('.sliders-test-bar__list')!;

	toggle.hidden = total === 0;
	toggle.textContent = `⚠ ${total}`;
	toggle.title = `${total} warning${total === 1 ? '' : 's'} in this passage — ${
		open ? 'hide' : 'show'
	}`;
	toggle.setAttribute('aria-expanded', String(open && total > 0));
	list.hidden = !open || total === 0;
	list.replaceChildren(
		...entries.slice(0, MAX_SHOWN).map(entry => {
			const li = document.createElement('li');

			li.textContent =
				entry.count > 1 ? `${entry.message} (×${entry.count})` : entry.message;
			return li;
		})
	);

	if (entries.length > MAX_SHOWN) {
		const li = document.createElement('li');

		li.textContent = `…and ${entries.length - MAX_SHOWN} more in the console.`;
		list.append(li);
	}
}

function onStateChange(event: Event): void {
	if ((event as CustomEvent<{name: string}>).detail.name === 'trail') {
		entries = [];
		open = false;
		update();
	}
}

function button(className: string, label: string, title: string) {
	const el = document.createElement('button');

	el.className = className;
	el.textContent = label;
	el.title = title;
	el.type = 'button';
	return el;
}

/**
 * Builds the bar and takes over from `<warning-list>`. No-op outside test mode, and safe to
 * call twice.
 */
export function initTestBar(): void {
	if (!get('config.testing') || root) {
		return;
	}

	// Take over what the banner already caught (the story-start vars run before this), then
	// remove it FIRST: its disconnect puts back the `console.warn` it wrapped, which would
	// unwrap ours if it went second.
	const banner = document.querySelector('warning-list') as
		| (HTMLElement & {warnings?: unknown[]})
		| null;
	const caught = banner?.warnings ?? [];

	banner?.remove();

	root = document.createElement('div');
	root.className = 'sliders-test-bar';
	root.setAttribute('role', 'toolbar');
	root.setAttribute('aria-label', 'Test play');

	const restartButton = button(
		'sliders-test-bar__restart',
		'↺ Restart',
		'Reset all variables and play again from where this test started'
	);
	const toggle = button('sliders-test-bar__warnings', '', '');
	const list = document.createElement('ul');

	list.className = 'sliders-test-bar__list';
	restartButton.addEventListener('click', () => restart());
	toggle.addEventListener('click', () => {
		open = !open;
		update();
	});
	root.append(restartButton, toggle, list);
	document.body.append(root);

	originalWarn = console.warn;
	console.warn = (...messages: unknown[]) => {
		addWarning(messages.map(text).join(' '));
		originalWarn!.apply(console, messages);
	};

	// A new passage starts a clean list, as `<warning-list>` did. The render that follows
	// a trail change is coalesced (`display/events.ts`), so its warnings land after this.
	window.addEventListener('state-change', onStateChange);

	for (const message of caught) {
		addWarning(text(message));
	}

	update();
}

/** Tests only. */
export function resetTestBar(): void {
	if (originalWarn) {
		console.warn = originalWarn;
	}

	window.removeEventListener('state-change', onStateChange);
	root?.remove();
	root = undefined;
	originalWarn = undefined;
	entries = [];
	open = false;
}
