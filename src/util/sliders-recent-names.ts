/**
 * Most-recently-used names for the scene editor's autocomplete.
 *
 * The asset library is app-wide, not per-story, so this is too. A slot is one
 * completion context -- `bg`, `cast`, `frame:mira` -- kept apart because the
 * frames an author reaches for on one character say nothing about another.
 *
 * localStorage, like `use-last-scene.ts`: losing it costs an author nothing but
 * alphabetical order, so it is never worth an error dialog. Two tabs editing at
 * once will clobber each other's lists; last write wins, and the cost is the
 * same nothing.
 */

export const RECENT_NAMES_KEY = 'sliders-recent-names';

/**
 * How many names a slot remembers. Past a dozen the "recent" group stops being
 * a shortlist and becomes the whole list again, which defeats the point.
 */
export const RECENT_LIMIT = 12;

/** Slot -> names, most recently used first. */
type RecentNames = Record<string, string[]>;

/**
 * Read through, write through. Completion fires on a keystroke, so parsing the
 * record every time would be wasteful, and the cache also keeps ordering stable
 * within a session if storage starts refusing writes.
 */
let cache: RecentNames | undefined;

function read(): RecentNames {
	if (cache) {
		return cache;
	}

	try {
		const raw = window.localStorage.getItem(RECENT_NAMES_KEY);
		const parsed = raw ? JSON.parse(raw) : {};

		// Anything could be under that key -- another tool, an older shape, a
		// half-written value. Keep only what looks like slots of strings.

		cache = {};

		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			for (const [slot, names] of Object.entries(parsed)) {
				if (Array.isArray(names)) {
					cache[slot] = names.filter(
						(name): name is string => typeof name === 'string'
					);
				}
			}
		}
	} catch (error) {
		cache = {};
	}

	return cache;
}

function write(names: RecentNames): void {
	cache = names;

	try {
		window.localStorage.setItem(RECENT_NAMES_KEY, JSON.stringify(names));
	} catch (error) {
		// Quota, or a browser with storage locked down. The in-memory cache still
		// orders this session's completions.
		console.warn('Could not store recently used scene names', error);
	}
}

/** The names used in a slot, most recent first. Never the same array twice. */
export function recentNames(slot: string): string[] {
	return [...(read()[slot] ?? [])];
}

/** Records a pick. Moves the name to the front if it was already there. */
export function noteNameUsed(slot: string, name: string): void {
	const trimmed = name.trim();

	if (!trimmed) {
		return;
	}

	const all = read();
	const next = [trimmed, ...(all[slot] ?? []).filter(one => one !== trimmed)];

	write({...all, [slot]: next.slice(0, RECENT_LIMIT)});
}

/**
 * Lifts the names an author has used before to the top of a completion list,
 * in most-recent-first order, and flags them so the dropdown can mark them.
 *
 * Everything else keeps the order it was built in -- the list builders group by
 * asset kind, and re-sorting here would throw that away.
 */
export function orderByRecent(
	names: string[],
	slot: string
): {name: string; recent: boolean}[] {
	const rank = new Map(recentNames(slot).map((name, index) => [name, index]));
	const used: string[] = [];
	const rest: string[] = [];

	for (const name of names) {
		(rank.has(name) ? used : rest).push(name);
	}

	used.sort((a, b) => rank.get(a)! - rank.get(b)!);

	return [
		...used.map(name => ({name, recent: true})),
		...rest.map(name => ({name, recent: false}))
	];
}

/** Test seam. Drops the in-memory cache so the next read hits storage. */
export function resetRecentNamesCache(): void {
	cache = undefined;
}
