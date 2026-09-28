import {
	BlobInfo,
	ChangesPage,
	Clock,
	LibRecord,
	LibTransport,
	NetworkError,
	RevEntry,
	WriteResult
} from '@sliders/asset-library';

/**
 * No backend configured. Every call fails like a dead network, so the engine keeps its
 * outbox and reports `offline` — local-only library, same code path. Configure a backend
 * later and the next engine drains the outbox.
 */
export class OfflineTransport implements LibTransport {
	private fail(): never {
		throw new NetworkError('No library server configured');
	}

	async hasBlobs(): Promise<string[]> {
		return this.fail();
	}

	async putBlob(): Promise<BlobInfo> {
		return this.fail();
	}

	async getBlob(): Promise<{bytes: Uint8Array; mime: string}> {
		return this.fail();
	}

	async headBlob(): Promise<boolean> {
		return this.fail();
	}

	async changes(): Promise<ChangesPage> {
		return this.fail();
	}

	async getRecord(): Promise<LibRecord> {
		return this.fail();
	}

	async putRecord(): Promise<WriteResult> {
		return this.fail();
	}

	async deleteRecord(): Promise<WriteResult> {
		return this.fail();
	}

	async revs(): Promise<RevEntry[]> {
		return this.fail();
	}
}

/**
 * Timers that never fire. An offline engine has nothing to push, so its debounced flush
 * is only noise (and, under jest, a timer outliving the test).
 */
export const inertClock: Clock = {
	now: () => Date.now(),
	setTimeout: () => 0,
	clearTimeout: () => undefined
};
