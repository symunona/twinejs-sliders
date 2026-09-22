/**
 * The link list under a stage, and when the reader is allowed to see it.
 *
 * `scene-modifier.ts` decides WHETHER the list is drawn. It cannot decide WHEN: it runs
 * once, at render time, and knows nothing about beat progress. So the modifier always
 * emits the list and `<sliders-stage>` holds it back until the scene's beats are done —
 * otherwise the choices stand under the stage from beat 1, answering the question before
 * the line that poses it has been read.
 *
 * Held back FROM SCRIPT, never by the stylesheet alone. Both hooks below are set by the
 * stage element and by nothing else, so a reader whose browser never upgrades the custom
 * element — and a scene whose payload fails to decode, which returns before any of this —
 * gets the list the moment the passage renders. The tradeoff is deliberate and one-sided:
 * a list nobody can reveal strands the reader in the scene, while a list shown too early
 * only spoils a choice.
 */

/** Marks a fork as some stage's own. Carries the reveal transition. */
const OWNED = 'sliders-fork';

/** On that same fork while the beats are still running. */
const PENDING = 'data-pending';

/**
 * The `<div class="fork">` this stage's links were rendered into, if it has one.
 *
 * Pairing is by POSITION, because the fork carries no identity of its own: Chapbook's
 * Markdown renderer turns the modifier's `> [[…]]` lines into a bare `<div class="fork">`
 * and there is no attribute to hang an index on. The modifier emits that list immediately
 * after the element, so the fork is whatever follows the stage once we have climbed out of
 * the `<p>` Markdown wrapped the element in.
 *
 * A `~` sibling selector cannot do this. Several `[scene]` blocks in one passage each emit
 * their own stage and their own fork, in order, and `~` would match every later fork from
 * any earlier stage.
 */
export function sceneLinkList(stage: Element): HTMLElement | undefined {
	// The climb stops at the passage body, so a scene that drew no list cannot reach out of
	// the passage and adopt a fork belonging to something else.
	const limit = stage.closest('article') ?? stage.ownerDocument.body;
	let node: Element = stage;

	while (node !== limit && !node.nextElementSibling && node.parentElement) {
		node = node.parentElement;
	}

	const next = node === limit ? null : node.nextElementSibling;

	return next instanceof HTMLElement && next.classList.contains('fork')
		? next
		: undefined;
}

/**
 * Hide this stage's link list until `releaseLinkList`, and hand it back.
 *
 * The list keeps its space in the layout (`visibility`, not `display` — see `sliders.css`)
 * so the reveal moves nothing on the page, and it leaves the tab order and the
 * accessibility tree while it waits, which `opacity: 0` alone would not do.
 */
export function holdLinkList(stage: Element): HTMLElement | undefined {
	const list = sceneLinkList(stage);

	if (list) {
		list.classList.add(OWNED);
		list.setAttribute(PENDING, '');
	}

	return list;
}

/** Show it. Safe to call twice, and on a stage that never had a list. */
export function releaseLinkList(list?: HTMLElement): void {
	list?.removeAttribute(PENDING);
}

/**
 * Put a released list back under wraps: the reader stepped BACK into the beats.
 *
 * The reveal is not a one-way door, because the beats are not either. A reader who walks
 * back into the middle of the scene is reading it again, and the choices are a spoiler
 * again — the same reason they were held the first time round.
 */
export function holdLinkListAgain(list?: HTMLElement): void {
	list?.setAttribute(PENDING, '');
}
