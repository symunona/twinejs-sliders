import {MemoryBlobCache} from '../blob-cache';
import {Clock, LibraryEngine, Notice} from '../engine';
import {FakeLibServer} from '../fake-server';
import {MemoryLocalDb} from '../local-db';
import {FetchLike, HttpTransport, LIB_BASE_PATH} from '../transport';
import {LibRecord, LibSocketMessage} from '../types';
import {pngDecoder} from './fixtures';

/**
 * The multi-user harness (asset-library-tests.md, "Shape"): one FakeLibServer, several
 * independent "browsers", each with its own persisted stores and a real LibraryEngine
 * talking HTTP (through HttpTransport) to the fake. No timers, no DOM.
 */

/** Deterministic clock: timers fire only when a test advances it. */
export class TestClock implements Clock {
	private time = 0;
	private nextId = 1;
	private timers = new Map<number, {at: number; callback: () => void}>();

	now(): number {
		return this.time;
	}

	setTimeout(callback: () => void, ms: number): unknown {
		const id = this.nextId++;

		this.timers.set(id, {at: this.time + ms, callback});

		return id;
	}

	clearTimeout(handle: unknown): void {
		this.timers.delete(handle as number);
	}

	get pending(): number {
		return this.timers.size;
	}

	advance(ms: number): void {
		const target = this.time + ms;

		for (;;) {
			let next: [number, {at: number; callback: () => void}] | undefined;

			for (const entry of this.timers) {
				if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) {
					next = entry;
				}
			}

			if (!next) {
				break;
			}

			this.timers.delete(next[0]);
			this.time = next[1].at;
			next[1].callback();
		}

		this.time = target;
	}
}

export interface LoggedRequest {
	method: string;
	/** Path under `/api/v1/lib`, query included: `/assets/<id>`, `/changes?since=4`. */
	path: string;
	/** 0 = never reached the server (offline, injected failure). */
	status: number;
	/** The If-Match header sent, e.g. `"5"`. */
	ifMatch?: string;
	/** `error` code of a non-2xx answer. */
	code?: string;
}

export type SocketMode = 'auto' | 'manual' | 'dead';

export class Browser {
	readonly db = new MemoryLocalDb();
	readonly blobs = new MemoryBlobCache();
	readonly requests: LoggedRequest[] = [];
	readonly notices: Notice[] = [];
	/** Socket messages received, not yet delivered to the engine. */
	readonly inbox: LibSocketMessage[] = [];
	engine!: LibraryEngine;
	isOnline = true;
	private failures: ((request: {method: string; path: string}) => boolean)[] =
		[];
	/** Runs before a request reaches the server: lets a test change the world mid-push. */
	beforeRequest?: (request: {method: string; path: string}) => void;
	private disconnect: () => void;

	constructor(
		readonly world: World,
		readonly name: string,
		readonly clientId: string
	) {
		this.disconnect = world.server.connect(clientId, message => {
			// A socket is down while offline, and a dead socket never delivers.
			if (this.isOnline && world.socket !== 'dead') {
				this.inbox.push(message);
			}
		});
	}

	readonly fetch: FetchLike = async (url, init) => {
		const path = url.slice(url.indexOf(LIB_BASE_PATH) + LIB_BASE_PATH.length);
		const method = init.method.toUpperCase();
		const ifMatch = init.headers['If-Match'];
		const logged: LoggedRequest = {
			method,
			path,
			status: 0,
			...(ifMatch ? {ifMatch} : {})
		};

		this.requests.push(logged);

		if (!this.isOnline) {
			throw new TypeError('Failed to fetch (offline)');
		}

		const failure = this.failures.findIndex(matches => matches({method, path}));

		if (failure >= 0) {
			this.failures.splice(failure, 1);
			throw new TypeError('Connection reset (injected)');
		}

		this.beforeRequest?.({method, path});

		const response = await this.world.server.fetch(url, init);

		logged.status = response.status;

		if (response.status >= 400) {
			try {
				logged.code = JSON.parse(await response.text()).error;
			} catch {
				// Not JSON: leave the code out.
			}
		}

		return response;
	};

	/** The next request matching this throws like a dropped connection. Once. */
	failNext(
		matches: (request: {method: string; path: string}) => boolean
	): void {
		this.failures.push(matches);
	}

	async boot(): Promise<void> {
		const transport = new HttpTransport(
			this.world.url,
			this.world.server.token,
			this.name,
			this.fetch,
			this.clientId
		);

		this.engine = new LibraryEngine({
			db: this.db,
			blobs: this.blobs,
			transport,
			clientName: this.name,
			clock: this.world.clock,
			decoder: pngDecoder,
			newId: this.world.newId
		});
		this.engine.onNotice(notice => this.notices.push(notice));
		await this.engine.start();
	}

	/** F5: drop the engine and everything in memory; keep db + blobs. */
	async reload(): Promise<void> {
		await this.engine.dispose();
		this.inbox.length = 0;
		await this.boot();
	}

	offline(): void {
		this.isOnline = false;
		this.inbox.length = 0;
	}

	async online(): Promise<void> {
		this.isOnline = true;
		await this.engine.reconnect();
	}

	close(): void {
		this.disconnect();
	}

	/** Index into `requests`, for "since this point" assertions. */
	mark(): number {
		return this.requests.length;
	}

	since(mark: number): LoggedRequest[] {
		return this.requests.slice(mark);
	}

	/** Record writes (PUT/DELETE of a record, not blobs) since a mark. */
	recordWrites(mark = 0): LoggedRequest[] {
		return this.since(mark).filter(
			request =>
				(request.method === 'PUT' || request.method === 'DELETE') &&
				!request.path.startsWith('/blobs/')
		);
	}

	/** Every write, blobs included. */
	writes(mark = 0): LoggedRequest[] {
		return this.since(mark).filter(
			request =>
				request.method === 'PUT' ||
				request.method === 'DELETE' ||
				(request.method === 'POST' && request.path !== '/blobs/has')
		);
	}

	blobPuts(mark = 0): LoggedRequest[] {
		return this.since(mark).filter(
			request => request.method === 'PUT' && request.path.startsWith('/blobs/')
		);
	}

	/** Local view by id. */
	get<T extends LibRecord = LibRecord>(id: string): T | undefined {
		return this.engine.get(id) as T | undefined;
	}
}

export interface WorldOptions {
	socket?: SocketMode;
	newId?: () => string;
}

export class World {
	readonly clock = new TestClock();
	readonly server: FakeLibServer;
	readonly url = 'http://lib.test';
	readonly browsers: Browser[] = [];
	socket: SocketMode;
	newId?: () => string;
	/** Passes the last settle() took. */
	lastPasses = 0;

	constructor(options: WorldOptions = {}) {
		this.socket = options.socket ?? 'auto';
		this.newId = options.newId;
		this.server = new FakeLibServer({
			now: () => Date.UTC(2026, 8, 28) + this.clock.now()
		});
	}

	static async create(
		names: string[],
		options: WorldOptions = {}
	): Promise<[World, ...Browser[]]> {
		const world = new World(options);
		const browsers: Browser[] = [];

		for (const name of names) {
			browsers.push(await world.add(name));
		}

		return [world, ...browsers];
	}

	async add(name: string): Promise<Browser> {
		const browser = new Browser(this, name, `${name}-tab`);

		await browser.boot();
		this.browsers.push(browser);

		return browser;
	}

	totalRequests(): number {
		return this.browsers.reduce(
			(sum, browser) => sum + browser.requests.length,
			0
		);
	}

	/** Hands queued socket messages to the engine(s). Manual socket mode calls this. */
	async deliver(browser?: Browser): Promise<void> {
		for (const target of browser ? [browser] : this.browsers) {
			if (!target.isOnline) {
				target.inbox.length = 0;
				continue;
			}

			for (const message of target.inbox.splice(0)) {
				await target.engine.notify(message.seq);
			}
		}

		await this.idle();
	}

	async idle(): Promise<void> {
		for (const browser of this.browsers) {
			await browser.engine.idle();
		}
	}

	/**
	 * Deliver socket messages, pull, drain every online outbox; repeat until one full pass
	 * issues zero requests. 50 passes without a quiet one = ping-pong: fail.
	 */
	async settle(maxPasses = 50): Promise<number> {
		for (let pass = 1; pass <= maxPasses; pass++) {
			const before = this.totalRequests();

			for (const browser of this.browsers) {
				if (!browser.isOnline) {
					continue;
				}

				if (this.socket === 'auto') {
					await this.deliver(browser);
				}

				await browser.engine.sync();
			}

			await this.idle();

			if (this.totalRequests() === before) {
				this.lastPasses = pass;
				return pass;
			}
		}

		throw new Error(
			`settle(): no quiet pass in ${maxPasses} passes — ping-pong`
		);
	}
}
