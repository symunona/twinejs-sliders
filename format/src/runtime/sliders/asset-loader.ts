/**
 * The download queue behind the preload plan.
 *
 * One entry per url. The next download is the highest-priority queued entry:
 *
 * 1. anything something is WAITING on right now (`need`) — a stage drawing it, a click
 *    heading for it — oldest wait first;
 * 2. then the lowest tier, then plan order inside it.
 *
 * Tiers above `openTier` are held back entirely, so the first scene's art does not share
 * the wire with tier 3's. `preload.ts` opens every tier once the first scene is up.
 *
 * Every step is an event (`events`, `subscribe`) — that is all the debugger reads.
 * Pure: the fetch is injected, so the jest suite drives it with fake downloads.
 */

export type EntryState = 'queued' | 'loading' | 'done' | 'failed';

export interface LoaderEntry {
	url: string;
	label: string;
	tier: number;
	/** Plan position, the tie-break inside a tier. */
	order: number;
	/** Passages whose art this is. */
	passages: string[];
	state: EntryState;
	expected: number;
	loaded: number;
	/** Set once a waiter has asked for it; lower = asked earlier. */
	urgent?: number;
	/** What first waited on it: `render <key>`, `click <passage>`. */
	urgentBy?: string;
	queuedAt: number;
	startedAt?: number;
	endedAt?: number;
	/** The object url once done. */
	local?: string;
	error?: string;
	mime?: string;
}

export type LoaderEventType =
	| 'plan'
	| 'queue'
	| 'urgent'
	| 'start'
	| 'done'
	| 'fail'
	| 'tier-done'
	| 'open'
	| 'reveal'
	| 'nav-wait'
	| 'nav-go'
	| 'nav-blocked'
	| 'autoplay'
	| 'boot-wait'
	| 'boot-click';

export interface LoaderEvent {
	/** ms since the loader was made. */
	t: number;
	type: LoaderEventType;
	url?: string;
	label?: string;
	tier?: number;
	detail?: string;
}

/** Downloads one entry, reports bytes, answers with a url the page can use. */
export type Fetcher = (
	entry: LoaderEntry,
	progress: () => void
) => Promise<string>;

export interface LoaderOptions {
	fetch: Fetcher;
	concurrency?: number;
	now?: () => number;
}

interface Waiter {
	promise: Promise<void>;
	resolve: () => void;
}

export class AssetLoader {
	readonly entries = new Map<string, LoaderEntry>();
	readonly events: LoaderEvent[] = [];
	/** Highest tier allowed to start without a waiter. */
	openTier = 0;

	private readonly fetcher: Fetcher;
	private readonly concurrency: number;
	private readonly now: () => number;
	private readonly epoch: number;
	private readonly waiters = new Map<string, Waiter>();
	private readonly listeners = new Set<(event: LoaderEvent) => void>();
	private active = 0;
	private order = 0;
	private urgency = 0;

	constructor(options: LoaderOptions) {
		this.fetcher = options.fetch;
		this.concurrency = options.concurrency ?? 6;
		this.now = options.now ?? (() => performance.now());
		this.epoch = this.now();
	}

	subscribe(listener: (event: LoaderEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	emit(event: Omit<LoaderEvent, 't'>): void {
		const full = {...event, t: Math.round(this.now() - this.epoch)};

		this.events.push(full);

		for (const listener of this.listeners) {
			listener(full);
		}
	}

	/**
	 * File a url under a tier. Asked again, it keeps the LOWER tier and gains the passage —
	 * the same backdrop in tier 0 and tier 2 is tier-0 art.
	 */
	add(
		url: string,
		info: {
			label: string;
			tier: number;
			passage?: string;
			bytes?: number;
			mime?: string;
			/** Unplanned and already waited on: urgent from the start. */
			urgentBy?: string;
		}
	): LoaderEntry {
		let entry = this.entries.get(url);

		if (!entry) {
			entry = {
				expected: info.bytes ?? 0,
				label: info.label,
				loaded: 0,
				mime: info.mime,
				order: this.order++,
				passages: [],
				queuedAt: Math.round(this.now() - this.epoch),
				state: 'queued',
				tier: info.tier,
				url,
				...(info.urgentBy === undefined
					? {}
					: {urgent: this.urgency++, urgentBy: info.urgentBy})
			};
			this.entries.set(url, entry);
			this.emit({
				detail: info.urgentBy,
				label: entry.label,
				tier: entry.tier,
				type: 'queue',
				url
			});
		} else if (info.tier < entry.tier) {
			entry.tier = info.tier;
		}

		if (info.passage && !entry.passages.includes(info.passage)) {
			entry.passages.push(info.passage);
		}

		this.pump();
		return entry;
	}

	/** Open tiers up to `tier` (Infinity = all). */
	open(tier: number): void {
		if (tier <= this.openTier) {
			return;
		}

		this.openTier = tier;
		this.emit({
			detail: tier === Infinity ? 'all tiers' : `tiers <= ${tier}`,
			type: 'open'
		});
		this.pump();
	}

	/**
	 * Something is waiting on this url NOW. Jumps the queue (tier gate included) and
	 * settles with the local copy, or the original url when the download failed — a
	 * picture that loads late beats no picture.
	 */
	async need(url: string, by: string): Promise<string> {
		const entry =
			this.entries.get(url) ?? this.add(url, {label: url, tier: 0, urgentBy: by});

		if (entry.state === 'queued' && entry.urgent === undefined) {
			entry.urgent = this.urgency++;
			entry.urgentBy = by;
			this.emit({detail: by, label: entry.label, tier: entry.tier, type: 'urgent', url});
			this.pump();
		}

		await this.settled(url);
		return entry.local ?? url;
	}

	/** Downloaded (or given up on): nothing left to wait for. */
	isSettled(url: string): boolean {
		const state = this.entries.get(url)?.state;

		return state === undefined || state === 'done' || state === 'failed';
	}

	settled(url: string): Promise<void> {
		if (this.isSettled(url)) {
			return Promise.resolve();
		}

		let waiter = this.waiters.get(url);

		if (!waiter) {
			let resolve!: () => void;
			const promise = new Promise<void>(r => (resolve = r));

			waiter = {promise, resolve};
			this.waiters.set(url, waiter);
		}

		return waiter.promise;
	}

	/** Every url settled. Does NOT raise their priority; `need` each one for that. */
	allSettled(urls: Iterable<string>): Promise<void> {
		return Promise.all([...urls].map(url => this.settled(url))).then(() => undefined);
	}

	/** The local copy, if this url is already down. */
	local(url: string): string | undefined {
		return this.entries.get(url)?.local;
	}

	private next(): LoaderEntry | undefined {
		let best: LoaderEntry | undefined;

		for (const entry of this.entries.values()) {
			if (entry.state !== 'queued') {
				continue;
			}

			if (entry.urgent === undefined && entry.tier > this.openTier) {
				continue;
			}

			if (!best || rank(entry, best) < 0) {
				best = entry;
			}
		}

		return best;
	}

	private pump(): void {
		while (this.active < this.concurrency) {
			const entry = this.next();

			if (!entry) {
				return;
			}

			void this.run(entry);
		}
	}

	private async run(entry: LoaderEntry): Promise<void> {
		this.active++;
		entry.state = 'loading';
		entry.startedAt = Math.round(this.now() - this.epoch);
		this.emit({
			detail: entry.urgentBy ? `urgent: ${entry.urgentBy}` : undefined,
			label: entry.label,
			tier: entry.tier,
			type: 'start',
			url: entry.url
		});

		try {
			entry.local = await this.fetcher(entry, () => this.progress?.(entry));
			entry.state = 'done';
		} catch (error) {
			entry.state = 'failed';
			entry.error = (error as Error).message;
		}

		entry.loaded = Math.max(entry.loaded, entry.expected);
		entry.endedAt = Math.round(this.now() - this.epoch);
		this.emit({
			detail:
				entry.state === 'done'
					? `${entry.endedAt - (entry.startedAt ?? 0)}ms ${kb(entry.loaded)}`
					: entry.error,
			label: entry.label,
			tier: entry.tier,
			type: entry.state === 'done' ? 'done' : 'fail',
			url: entry.url
		});
		this.progress?.(entry);
		this.active--;

		const waiter = this.waiters.get(entry.url);

		if (waiter) {
			this.waiters.delete(entry.url);
			waiter.resolve();
		}

		this.checkTier(entry.tier);
		this.pump();
	}

	/** Byte progress hook for the bar. */
	progress?: (entry: LoaderEntry) => void;

	private readonly tiersDone = new Set<number>();

	private checkTier(tier: number): void {
		if (this.tiersDone.has(tier)) {
			return;
		}

		const inTier = [...this.entries.values()].filter(e => e.tier === tier);

		if (inTier.every(e => e.state === 'done' || e.state === 'failed')) {
			this.tiersDone.add(tier);
			this.emit({
				detail: `${inTier.length} assets, ${kb(
					inTier.reduce((sum, e) => sum + e.loaded, 0)
				)}`,
				tier,
				type: 'tier-done'
			});
		}
	}
}

/** Negative when `a` goes first. */
function rank(a: LoaderEntry, b: LoaderEntry): number {
	if (a.urgent !== undefined || b.urgent !== undefined) {
		return (a.urgent ?? Infinity) - (b.urgent ?? Infinity);
	}

	return a.tier - b.tier || a.order - b.order;
}

export function kb(bytes: number): string {
	return bytes >= 1e6
		? `${(bytes / 1e6).toFixed(1)} MB`
		: bytes >= 1e3
		? `${Math.round(bytes / 1e3)} KB`
		: `${bytes} B`;
}
