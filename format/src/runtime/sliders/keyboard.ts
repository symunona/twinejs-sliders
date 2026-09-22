/**
 * Reading a story with the keyboard.
 *
 * Four keys, and they mean what they mean on a remote control: Right is "on", Left is
 * "back", Up and Down pick between the ways out, Enter takes the one that is picked.
 *
 * | key | in a scene | when the scene is over |
 * |---|---|---|
 * | Right | next beat | the only way out, if there is exactly one |
 * | Left | previous line, then out of the passage | out of the passage |
 * | Up / Down | move between the ways out | same |
 * | Enter | follow the picked way out | same |
 *
 * The selection is the DOM's own focus rather than a highlight this file tracks. Every
 * link in the player is already a focusable element that activates itself on Enter — a
 * bubble `<a>`, a `<passage-link>`, a clickable entity with `role="link"` — so focus
 * costs nothing, survives a re-render, matches what a Tab-key reader sees, and reaches a
 * screen reader without a word of ARIA here. The alternative, an index into a list of
 * links, would need all of that written again and would disagree with Tab the moment a
 * reader used both.
 *
 * Nothing here is scene-specific: a prose passage with two `[[links]]` steers exactly the
 * same way, which is the point — the reader cannot tell which passages happen to hold a
 * scene, and should not have to.
 */

import {stepBackPassage} from './history';

/**
 * What this file needs of a stage. `<sliders-stage>` implements it.
 *
 * A shape rather than the class, and checked at runtime, because "is there a scene here
 * that can be steered" and "is this an instance of that class" are not the same question.
 * A `<sliders-stage>` whose custom element never upgraded — an old browser, a script that
 * failed to load — is still in the DOM and answers `undefined` here, so the keys fall
 * through to the links under it instead of calling methods that do not exist.
 */
interface Steerable {
	canAdvance(): boolean;
	advance(): void;
	stepBack(): boolean;
}

/**
 * Everything the reader can walk to, in reading order.
 *
 * Bubble links come first because they are inside the stage element, then clickable
 * entities, then the list under the stage — document order does that for free, and it is
 * also the order the eye reads them in.
 */
const LINKS = [
	'a.link',
	'a.sliders-link',
	'passage-link',
	'[data-sliders-link]'
].join(',');

/** Keys we take over. Everything else, including Tab and Space, is left to the browser. */
const HANDLED = new Set([
	'ArrowDown',
	'ArrowLeft',
	'ArrowRight',
	'ArrowUp',
	'Enter'
]);

let listening = false;

function isTyping(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;

	if (!el || !(el instanceof HTMLElement)) {
		return false;
	}

	return (
		el.isContentEditable ||
		el instanceof HTMLInputElement ||
		el instanceof HTMLTextAreaElement ||
		el instanceof HTMLSelectElement
	);
}

/** The passage body, or the whole document for a story whose chrome differs. */
function readingRoot(): ParentNode {
	return document.querySelector('article') ?? document.body;
}

/**
 * The stage the reader is in front of.
 *
 * The LAST one in the passage, because several `[scene]` blocks in one passage play top to
 * bottom and the last to mount is the one still running. A passage with no scene at all
 * gets `undefined`, and every key falls through to the link half of this file.
 */
function activeStage(): Steerable | undefined {
	const stages = readingRoot().querySelectorAll('sliders-stage');
	const last = stages[stages.length - 1] as Partial<Steerable> | undefined;

	return typeof last?.canAdvance === 'function' &&
		typeof last.advance === 'function' &&
		typeof last.stepBack === 'function'
		? (last as Steerable)
		: undefined;
}

/**
 * The ways out that are offered RIGHT NOW.
 *
 * A held link list is not one of them. `<sliders-stage>` hides that list until the beats
 * are done precisely so the choices do not answer the question early, and a keyboard that
 * could tab into the hidden list would hand the reader the same spoiler the stylesheet is
 * busy withholding.
 */
function links(): HTMLElement[] {
	return [...readingRoot().querySelectorAll<HTMLElement>(LINKS)].filter(
		el => !el.closest('[data-pending], [hidden]')
	);
}

function move(delta: number): void {
	const list = links();

	if (list.length === 0) {
		return;
	}

	const at = list.indexOf(document.activeElement as HTMLElement);
	const next =
		at === -1
			? delta > 0
				? 0
				: list.length - 1
			: (at + delta + list.length) % list.length;

	list[next].focus();
}

/** Take the only way out, if there is exactly one. */
function followOnly(): boolean {
	const list = links();

	if (list.length !== 1) {
		return false;
	}

	list[0].click();
	return true;
}

function onKeyDown(event: KeyboardEvent): void {
	if (
		event.defaultPrevented ||
		event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		!HANDLED.has(event.key) ||
		isTyping(event.target)
	) {
		return;
	}

	switch (event.key) {
		case 'ArrowRight': {
			const stage = activeStage();

			// A beat first, always: Right past the last line is what turns the page, and a
			// scene whose only exit is a single link should not skip its own ending.
			if (stage?.canAdvance()) {
				event.preventDefault();
				stage.advance();
				return;
			}

			if (followOnly()) {
				event.preventDefault();
			}

			return;
		}

		case 'ArrowLeft': {
			// The stage answers `false` at its own first beat, which is exactly when back
			// stops meaning "one line" and starts meaning "one passage".
			if (activeStage()?.stepBack() || stepBackPassage()) {
				event.preventDefault();
			}

			return;
		}

		case 'ArrowUp':
			event.preventDefault();
			move(-1);
			return;

		case 'ArrowDown':
			event.preventDefault();
			move(1);
			return;

		case 'Enter': {
			// A focused link handles its own Enter — `<passage-link>` and the entity links
			// both listen for it, and an `<a href>` gets it from the browser. Pressing it
			// for them would navigate twice.
			if (links().includes(document.activeElement as HTMLElement)) {
				return;
			}

			if (followOnly()) {
				event.preventDefault();
			}
		}
	}
}

/** Idempotent: the story may re-init (the editor preview does) without stacking listeners. */
export function initKeyboard(): void {
	if (listening) {
		return;
	}

	listening = true;
	document.addEventListener('keydown', onKeyDown);
}
