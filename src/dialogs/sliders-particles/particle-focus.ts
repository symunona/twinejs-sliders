/**
 * "Open the Particles dialog on THIS emitter." Same bus as `character-focus.ts`, for the
 * same reason: the dialog reducer dedupes `addDialog` by props, so the target rides here
 * and the dispatch carries none — an open dialog is raised and switches.
 *
 * Held until taken (5 s), because the click publishes before the dialog mounts.
 */

export interface ParticleFocusRequest {
	/** Asset id or name — a scene entity's `ref`. */
	ref: string;
	serial: number;
}

const FRESH_MS = 5000;

let current: ParticleFocusRequest | undefined;
let madeAt = 0;
let serial = 0;
const listeners = new Set<(request: ParticleFocusRequest) => void>();

export function requestParticleFocus(ref: string): void {
	current = {ref, serial: ++serial};
	madeAt = Date.now();

	for (const listener of [...listeners]) {
		listener(current);
	}
}

export function takePendingParticleFocus(): ParticleFocusRequest | undefined {
	const request = current && Date.now() - madeAt < FRESH_MS ? current : undefined;

	current = undefined;

	return request;
}

export function onParticleFocus(
	listener: (request: ParticleFocusRequest) => void
): () => void {
	listeners.add(listener);

	return () => {
		listeners.delete(listener);
	};
}
