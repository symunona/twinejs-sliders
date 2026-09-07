/**
 * Full-screen scenes, as a body class.
 *
 * Ref-counted because a passage can hold more than one `[scene]` block: the class goes on
 * when the first stage connects and comes off when the last one disconnects, and a
 * navigation that swaps one scene passage for another never flashes the page layout.
 */

const CINEMA_CLASS = 'sliders-cinema';

let stages = 0;

export function enterCinema(): void {
	stages++;
	document.body.classList.add(CINEMA_CLASS);
}

export function leaveCinema(): void {
	stages = Math.max(0, stages - 1);

	if (stages === 0) {
		document.body.classList.remove(CINEMA_CLASS);
	}
}
