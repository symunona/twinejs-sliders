import {holdLinkList, releaseLinkList, sceneLinkList} from '../link-list';

/**
 * The shape `scene-modifier.ts` + Chapbook's Markdown renderer actually produce: the
 * element inside a `<p>`, its links in a `<div class="fork">` right after that paragraph,
 * and the whole passage inside `<article>` (see `page-transition.ts`).
 */
function renderPassage(html: string): HTMLElement {
	document.body.innerHTML = `<article><div>${html}</div></article>`;
	return document.body.querySelector('article') as HTMLElement;
}

function stageWithList(index = 0) {
	return `<p><sliders-stage data-index="${index}"></sliders-stage></p>
		<div class="fork"><p><a class="link" href="#">out</a></p></div>`;
}

function stages(root: HTMLElement) {
	return Array.from(root.querySelectorAll('sliders-stage'));
}

describe('sceneLinkList', () => {
	it('finds the fork after the paragraph the stage was wrapped in', () => {
		const article = renderPassage(stageWithList());

		expect(sceneLinkList(stages(article)[0])).toBe(
			article.querySelector('.fork')
		);
	});

	it('finds a fork that is the stage’s own next sibling', () => {
		const article = renderPassage(
			'<sliders-stage></sliders-stage><div class="fork"></div>'
		);

		expect(sceneLinkList(stages(article)[0])).toBe(
			article.querySelector('.fork')
		);
	});

	it('gives each scene in a passage its own fork', () => {
		const article = renderPassage(stageWithList(0) + stageWithList(1));
		const forks = Array.from(article.querySelectorAll('.fork'));

		expect(forks).toHaveLength(2);
		expect(sceneLinkList(stages(article)[0])).toBe(forks[0]);
		expect(sceneLinkList(stages(article)[1])).toBe(forks[1]);
	});

	it('finds nothing for a scene whose links were not drawn', () => {
		// The second scene drew a list, the first did not. Position alone must not hand the
		// first stage the second one's fork.
		const article = renderPassage(
			'<p><sliders-stage data-index="0"></sliders-stage></p>' + stageWithList(1)
		);

		expect(sceneLinkList(stages(article)[0])).toBeUndefined();
	});

	it('does not reach outside the passage', () => {
		document.body.innerHTML =
			'<article><div><p><sliders-stage></sliders-stage></p></div></article>' +
			'<div class="fork">a fork belonging to the page, not the scene</div>';

		expect(
			sceneLinkList(document.body.querySelector('sliders-stage') as Element)
		).toBeUndefined();
	});

	it('ignores a following element that is not a fork', () => {
		const article = renderPassage(
			'<p><sliders-stage></sliders-stage></p><p>prose</p>'
		);

		expect(sceneLinkList(stages(article)[0])).toBeUndefined();
	});
});

describe('holdLinkList / releaseLinkList', () => {
	it('hides the list, then reveals it', () => {
		const article = renderPassage(stageWithList());
		const fork = article.querySelector('.fork') as HTMLElement;
		const held = holdLinkList(stages(article)[0]);

		expect(held).toBe(fork);
		expect(fork.classList.contains('sliders-fork')).toBe(true);
		expect(fork.hasAttribute('data-pending')).toBe(true);

		releaseLinkList(held);
		expect(fork.hasAttribute('data-pending')).toBe(false);
		// The marker class stays: it carries the transition the reveal just used.
		expect(fork.classList.contains('sliders-fork')).toBe(true);
	});

	it('leaves a foreign fork alone', () => {
		const article = renderPassage(
			'<p><sliders-stage></sliders-stage></p><p>prose</p><div class="fork"></div>'
		);

		expect(holdLinkList(stages(article)[0])).toBeUndefined();
		expect(
			(article.querySelector('.fork') as HTMLElement).hasAttribute(
				'data-pending'
			)
		).toBe(false);
	});

	it('is safe to release twice, and to release nothing', () => {
		const article = renderPassage(stageWithList());
		const held = holdLinkList(stages(article)[0]);

		releaseLinkList(held);
		releaseLinkList(held);
		releaseLinkList(undefined);

		expect(
			(article.querySelector('.fork') as HTMLElement).hasAttribute(
				'data-pending'
			)
		).toBe(false);
	});
});

/**
 * The timing the whole feature rests on.
 *
 * `<sliders-stage>` holds its list in `connectedCallback`, and Chapbook inserts a whole
 * passage in one `innerHTML` write (`page-transition.ts`). Custom element reactions are
 * queued and run after that write, so the fork is already a sibling by the time the
 * element wakes up. If it were not, the stage would find nothing and the list would stay
 * visible from beat 1 — the bug this module exists to fix, silently back.
 */
describe('inside connectedCallback', () => {
	it('sees the fork the same passage write put after it', () => {
		const found: (HTMLElement | undefined)[] = [];

		customElements.define(
			'link-list-probe',
			class extends HTMLElement {
				connectedCallback() {
					found.push(holdLinkList(this));
				}
			}
		);

		document.body.innerHTML = '<article></article>';
		(document.querySelector('article') as HTMLElement).innerHTML =
			'<div><p><link-list-probe></link-list-probe></p>' +
			'<div class="fork" id="first"></div>' +
			'<p><link-list-probe></link-list-probe></p>' +
			'<div class="fork" id="second"></div></div>';

		expect(found).toHaveLength(2);
		expect(found[0]?.id).toBe('first');
		expect(found[1]?.id).toBe('second');
		expect(found[0]?.hasAttribute('data-pending')).toBe(true);
	});
});
