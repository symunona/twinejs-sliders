/**
 * Navigate past a <Prompt> without its confirm.
 *
 * The toolbar's Back button is a deliberate click, so asking "are you sure?" after it
 * only slows the author down. The confirm is for the back you did NOT mean: a mouse
 * gesture, a trackpad swipe, the browser's own button. All of them are the same history
 * POP as the toolbar's `goBack()`, so the router cannot tell them apart -- this flag is
 * how the button says "this one was me".
 *
 * Read by `useNavConfirm`. Cleared on the next location change whether or not anything
 * asked, so an unblocked click cannot leave it armed for a later gesture.
 */

interface Listenable {
	listen(listener: () => void): () => void;
}

let skipNext = false;

export function leaveWithoutAsking(history: Listenable, navigate: () => void) {
	skipNext = true;

	const unlisten = history.listen(() => {
		skipNext = false;
		unlisten();
	});

	navigate();
}

/** True once per `leaveWithoutAsking`. */
export function consumeLeaveWithoutAsking(): boolean {
	const result = skipNext;

	skipNext = false;
	return result;
}
