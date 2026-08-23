/**
 * Every mutation, over HTTP and nothing else (spec 12 §0).
 *
 * Reads may take the short path through DATA_DIR; writes may not. One `PUT` to loopback bumps
 * the rev, snapshots the outgoing body into `revs/`, refreshes the cached counts in
 * `meta.json`, serialises against a concurrent autosave and tells every open editor. Hand
 * editing `data/` buys none of that and quietly breaks all five, which is why there is no
 * local implementation of this interface to fall back to.
 */

import {Http} from './source/http';
import type {Config, Manifest, StoryBody, WriteClient} from './types';

const enc = encodeURIComponent;

/** `If-Match: "42"` — rev is the concurrency token for everything the store holds. */
function quoted(rev: number): string {
	return `"${rev}"`;
}

export class HttpWriteClient implements WriteClient {
	constructor(readonly http: Http) {}

	async putStory(
		storyId: string,
		body: StoryBody,
		ifMatch: number
	): Promise<{id: string; rev: number; updatedAt: string; bytes: number}> {
		return this.http.json(`/stories/${enc(storyId)}`, {
			body: JSON.stringify({client: this.http.options.clientName, story: body}),
			headers: {'Content-Type': 'application/json', 'If-Match': quoted(ifMatch)},
			method: 'PUT'
		});
	}

	async putManifest(
		storyId: string,
		manifest: Manifest,
		ifMatch: number
	): Promise<{rev: number}> {
		// `rev` and `missing` belong to the server: one is the counter it owns, the other is a
		// fact about the blobs on disk. Sending either back would be asking it to trust us.
		const payload = {
			assets: manifest.assets,
			characters: manifest.characters,
			version: manifest.version
		};

		return this.http.json(`/stories/${enc(storyId)}/assets`, {
			body: JSON.stringify(payload),
			headers: {'Content-Type': 'application/json', 'If-Match': quoted(ifMatch)},
			method: 'PUT'
		});
	}

	async putAsset(
		storyId: string,
		assetId: string,
		bytes: Buffer,
		hash: string,
		mime: string
	): Promise<void> {
		await this.http.send(`/stories/${enc(storyId)}/assets/${enc(assetId)}`, {
			// The server re-hashes what it receives and answers 422 on a mismatch, so a
			// truncated upload can never reach the path HEAD reports on.
			body: new Uint8Array(bytes),
			headers: {'Content-Type': mime || 'application/octet-stream', 'X-Asset-Hash': hash},
			method: 'PUT'
		});
	}

	async deleteStory(storyId: string, purge: boolean): Promise<void> {
		await this.http.send(`/stories/${enc(storyId)}${purge ? '?purge=1' : ''}`, {
			method: 'DELETE'
		});
	}

	async restore(
		storyId: string,
		rev: number
	): Promise<{rev: number; restoredFrom: number; missingAssets: string[]}> {
		return this.http.json(`/stories/${enc(storyId)}/restore`, {
			body: JSON.stringify({rev}),
			headers: {'Content-Type': 'application/json'},
			method: 'POST'
		});
	}

	async ping(): Promise<Record<string, unknown>> {
		return this.http.json('/ping');
	}

	async health(): Promise<Record<string, unknown>> {
		return this.http.json('/health');
	}
}

export function makeWriteClient(config: Config): WriteClient {
	return new HttpWriteClient(
		new Http({
			clientId: config.clientId,
			clientName: config.clientName,
			server: config.server,
			token: config.token
		})
	);
}
