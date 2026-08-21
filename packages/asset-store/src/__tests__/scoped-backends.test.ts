/**
 * Assets are stored per story. What that means for the IndexedDB backend is a key prefix,
 * and the one thing that must not drift is the legacy scope: the empty one has to keep
 * using the bare keys the shared library wrote before scoping existed, or every asset an
 * author uploaded before this change is unreachable.
 */

import {IndexedDbBackend} from '../backends/indexeddb-backend';
import {emptyManifest} from '../asset-store.types';

/**
 * Just enough of IndexedDB to see which keys the backend touches. Two object stores, one
 * flat map each, and requests that resolve on the next tick like the real thing.
 */
function fakeIndexedDb() {
	const data: Record<string, Map<string, unknown>> = {
		blobs: new Map(),
		manifest: new Map()
	};

	function request<T>(result: T) {
		const request: any = {result};

		// The backend attaches its handlers after this returns, exactly as it would with a
		// real request.
		setTimeout(() => request.onsuccess?.(), 0);
		return request;
	}

	const database = {
		objectStoreNames: {contains: () => true},
		transaction(name: string) {
			const map = data[name];

			return {
				objectStore() {
					return {
						get: (key: string) => request(map.get(key)),
						put: (value: unknown, key: string) => {
							map.set(key, value);
							return request(undefined);
						},
						delete: (key: string) => {
							map.delete(key);
							return request(undefined);
						}
					};
				}
			};
		}
	};

	return {
		data,
		indexedDB: {
			open() {
				const request: any = {result: database};

				setTimeout(() => request.onsuccess?.(), 0);
				return request;
			}
		}
	};
}

describe('IndexedDbBackend scoping', () => {
	let fake: ReturnType<typeof fakeIndexedDb>;

	beforeEach(() => {
		fake = fakeIndexedDb();
		(globalThis as any).indexedDB = fake.indexedDB;
	});

	afterEach(() => {
		delete (globalThis as any).indexedDB;
	});

	it('prefixes a story’s keys with its id', async () => {
		const backend = new IndexedDbBackend('story-1');

		await backend.writeManifest(emptyManifest());
		await backend.writeBlob('a_8f21', new Blob(['x']));

		expect([...fake.data.manifest.keys()]).toEqual(['manifest:story-1']);
		expect([...fake.data.blobs.keys()]).toEqual(['story-1/a_8f21']);
	});

	it('leaves the legacy scope’s keys as they were', async () => {
		const backend = new IndexedDbBackend();

		await backend.writeManifest(emptyManifest());
		await backend.writeBlob('a_8f21', new Blob(['x']));

		expect([...fake.data.manifest.keys()]).toEqual(['manifest']);
		expect([...fake.data.blobs.keys()]).toEqual(['a_8f21']);
	});

	it('cannot read another story’s assets', async () => {
		const mine = new IndexedDbBackend('story-1');
		const theirs = new IndexedDbBackend('story-2');

		await mine.writeBlob('a_8f21', new Blob(['x']));

		expect(await theirs.readBlob('a_8f21')).toBeUndefined();
		expect(await mine.readBlob('a_8f21')).toBeDefined();
	});

	it('deletes only its own scope’s blob', async () => {
		const mine = new IndexedDbBackend('story-1');
		const theirs = new IndexedDbBackend('story-2');

		await mine.writeBlob('a_8f21', new Blob(['x']));
		await theirs.writeBlob('a_8f21', new Blob(['y']));
		await theirs.deleteBlob('a_8f21');

		expect([...fake.data.blobs.keys()]).toEqual(['story-1/a_8f21']);
	});
});
