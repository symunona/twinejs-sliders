/**
 * Order-insensitive JSON, for comparing two objects that mean the same thing.
 *
 * Both sides of asset sync need it, for the same reason and against the same data. The
 * push fingerprints a whole manifest to decide whether to write one at all; the pull
 * compares one asset's provenance to decide whether anything arrived. A meta that came
 * over the wire carries its keys in the sender's order and a locally built one in ours,
 * and `edits` alone is a six-field object — compared by raw `JSON.stringify`, the two
 * would differ on nothing but spelling.
 *
 * What that costs if the two copies drift is not a wrong answer once. A compare that
 * reports a difference where there is none makes a pull fire a library change, which
 * schedules a push, which bumps the server's rev, which wakes the other client, which
 * pulls — for as long as both editors are open. See `.claude/ARCHITECTURE.md` § Sync
 * model rule 3.
 *
 * `undefined` entries are dropped rather than encoded, so an absent key and a key set to
 * `undefined` compare equal — which is what they mean in an `AssetMeta`.
 */
export function stable(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stable).join(',')}]`;
	}

	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, item]) => item !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

		return `{${entries
			.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
			.join(',')}}`;
	}

	return JSON.stringify(value) ?? 'null';
}
