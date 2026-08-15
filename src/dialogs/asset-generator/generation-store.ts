import {AssetId} from '@sliders/scene-types';
import {ProviderId} from './models';

/**
 * Generated images live in their own IndexedDB database, not in the asset library.
 *
 * Most of what a model produces is a near miss, and a library full of near misses is
 * worse than no library. History is a scratchpad: it keeps what was made and what it
 * was asked for, and nothing reaches the library--or a bundle, or a story--until
 * someone saves it deliberately.
 */

const DATABASE_NAME = 'sliders-generations';
const DATABASE_VERSION = 1;
const STORE = 'generations';

export interface Generation {
	/** Assets that were attached as references, for re-running a prompt. */
	attachments: AssetId[];
	blob: Blob;
	createdAt: number;
	id: string;
	model: string;
	prompt: string;
	provider: ProviderId;
	aspect: string;
	/** What this has already been saved to the library as, so it isn't saved twice. */
	savedAs: string[];
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

let database: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
	if (!database) {
		database = new Promise((resolve, reject) => {
			const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

			request.onupgradeneeded = () => {
				if (!request.result.objectStoreNames.contains(STORE)) {
					request.result.createObjectStore(STORE, {keyPath: 'id'});
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	return database;
}

async function transact<T>(
	mode: IDBTransactionMode,
	body: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	const connection = await open();

	return promisify(body(connection.transaction(STORE, mode).objectStore(STORE)));
}

export function generationId(): string {
	const bytes = new Uint8Array(8);

	globalThis.crypto.getRandomValues(bytes);

	return `g_${Array.from(bytes)
		.map(byte => byte.toString(16).padStart(2, '0'))
		.join('')}`;
}

/** Newest first, which is the only order the history is ever shown in. */
export async function listGenerations(): Promise<Generation[]> {
	const all = await transact<Generation[]>('readonly', store => store.getAll());

	return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function putGeneration(
	generation: Generation
): Promise<Generation> {
	await transact('readwrite', store => store.put(generation));
	return generation;
}

export async function removeGeneration(id: string): Promise<void> {
	await transact('readwrite', store => store.delete(id));
}

export async function updateGeneration(
	id: string,
	changes: Partial<Generation>
): Promise<Generation | undefined> {
	const existing = await transact<Generation | undefined>('readonly', store =>
		store.get(id)
	);

	if (!existing) {
		return undefined;
	}

	const updated = {...existing, ...changes};

	await transact('readwrite', store => store.put(updated));
	return updated;
}
