/**
 * "Show me this asset in the asset manager."
 *
 * A module-level bus rather than a dialog prop, because the dialog reducer dedupes an
 * `addDialog` by comparing `props` with `isEqual`: dispatching the manager with a focus
 * target in its props would open a SECOND copy whenever one was already open with different
 * props — or none. Opening with no props raises the existing dialog, and the target rides
 * alongside on this channel.
 *
 * The request is held rather than only broadcast, because a double click that opens the
 * manager publishes before the dialog exists to hear it. It is taken once and then gone: a
 * request nobody consumed must not make the next ordinary open jump to an old tile.
 */

/** What a scene entity's `ref` is: a character id or an asset name, the caller cannot say. */
export interface AssetFocusRequest {
	ref: string;
	/** Bumped per request, so asking for the same ref twice still counts as twice. */
	serial: number;
}

/** A request older than this was not caused by whatever is opening the dialog now. */
const FRESH_MS = 5000;

let current: AssetFocusRequest | undefined;
let madeAt = 0;
let serial = 0;
const listeners = new Set<(request: AssetFocusRequest) => void>();

export function requestAssetFocus(ref: string): void {
	current = {ref, serial: ++serial};
	madeAt = Date.now();

	for (const listener of [...listeners]) {
		listener(current);
	}
}

/** The last unconsumed request, for a dialog that mounted after it was made. */
export function takePendingAssetFocus(): AssetFocusRequest | undefined {
	const request =
		current && Date.now() - madeAt < FRESH_MS ? current : undefined;

	current = undefined;

	return request;
}

export function onAssetFocus(
	listener: (request: AssetFocusRequest) => void
): () => void {
	listeners.add(listener);

	return () => {
		listeners.delete(listener);
	};
}
