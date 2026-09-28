import {ENVELOPE_FIELDS, LibRecord} from './types';

/**
 * 3-way record merge (plan 2, "3-way merge").
 *
 * Per top-level field, base → local vs base → remote:
 *
 * | local   | remote  | result            |
 * |---------|---------|-------------------|
 * | same    | changed | remote            |
 * | changed | same    | local             |
 * | changed | changed, equal | either     |
 * | changed | changed, differ | CONFLICT  |
 *
 * `recipe`, `sidecars` and `poses` merge per key, so one side's mask and the other's effect
 * both survive. `tags` merge as sets. `deleted` against any change on the other side is a
 * conflict of its own ("delete vs edit"): taking the delete silently would drop an edit,
 * taking the edit silently would resurrect something a teammate removed.
 *
 * A conflicted field holds the REMOTE value in `merged`, so "theirs" is `merged` as is.
 */

/** Fields merged key by key. A conflict is reported as `recipe.effect`. */
export const KEYED_FIELDS = new Set(['recipe', 'sidecars', 'poses']);

/** Fields merged as sets of strings. */
export const SET_FIELDS = new Set(['tags']);

const ENVELOPE = new Set<string>(ENVELOPE_FIELDS);

export interface MergeResult {
	merged: LibRecord;
	/** Field paths both sides changed differently: `name`, `blob`, `recipe.mask`, `deleted`. */
	conflicts: string[];
}

/** JSON with sorted keys, `undefined` dropped. Equality for record content. */
export function stableStringify(value: unknown): string {
	if (value === undefined) {
		return 'undefined';
	}

	return JSON.stringify(value, (_key, inner) => {
		if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
			const sorted: Record<string, unknown> = {};

			for (const key of Object.keys(inner).sort()) {
				if (inner[key] !== undefined) {
					sorted[key] = inner[key];
				}
			}

			return sorted;
		}

		return inner;
	});
}

export function deepEqual(a: unknown, b: unknown): boolean {
	return stableStringify(a) === stableStringify(b);
}

export function clone<T>(value: T): T {
	return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/** Everything but id/type/rev/by/at. */
export function content(
	record: LibRecord | undefined
): Record<string, unknown> {
	const out: Record<string, unknown> = {};

	if (!record) {
		return out;
	}

	for (const [key, value] of Object.entries(record)) {
		if (!ENVELOPE.has(key) && value !== undefined) {
			out[key] = value;
		}
	}

	out.deleted = !!record.deleted;

	return out;
}

/** Same record content, ignoring rev/by/at. */
export function sameContent(
	a: LibRecord | undefined,
	b: LibRecord | undefined
): boolean {
	return deepEqual(content(a), content(b));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(item => typeof item === 'string');
}

type Field = {value: unknown; conflict: boolean};

function mergeValue(base: unknown, local: unknown, remote: unknown): Field {
	const localChanged = !deepEqual(base, local);
	const remoteChanged = !deepEqual(base, remote);

	if (!localChanged) {
		return {value: remote, conflict: false};
	}

	if (!remoteChanged || deepEqual(local, remote)) {
		return {value: local, conflict: false};
	}

	return {value: remote, conflict: true};
}

function mergeSet(base: unknown, local: unknown, remote: unknown): Field {
	if (
		!(base === undefined || isStringArray(base)) ||
		!(local === undefined || isStringArray(local)) ||
		!(remote === undefined || isStringArray(remote))
	) {
		return mergeValue(base, local, remote);
	}

	const b = new Set(base ?? []);
	const l = new Set(local ?? []);
	const r = new Set(remote ?? []);
	const removed = new Set([...b].filter(tag => !l.has(tag) || !r.has(tag)));
	const out: string[] = [];

	for (const tag of [...(remote ?? []), ...(local ?? [])]) {
		if (!removed.has(tag) && !out.includes(tag)) {
			out.push(tag);
		}
	}

	// Keep `undefined` when neither side ever had the field.
	if (base === undefined && local === undefined && remote === undefined) {
		return {value: undefined, conflict: false};
	}

	return {value: out, conflict: false};
}

function mergeKeyed(
	field: string,
	base: unknown,
	local: unknown,
	remote: unknown,
	conflicts: string[]
): unknown {
	if (
		!(base === undefined || isPlainObject(base)) ||
		!(local === undefined || isPlainObject(local)) ||
		!(remote === undefined || isPlainObject(remote))
	) {
		const result = mergeValue(base, local, remote);

		if (result.conflict) {
			conflicts.push(field);
		}

		return result.value;
	}

	const b = (base ?? {}) as Record<string, unknown>;
	const l = (local ?? {}) as Record<string, unknown>;
	const r = (remote ?? {}) as Record<string, unknown>;
	const keys = new Set([
		...Object.keys(b),
		...Object.keys(l),
		...Object.keys(r)
	]);
	const out: Record<string, unknown> = {};

	for (const key of [...keys].sort()) {
		const result = mergeValue(b[key], l[key], r[key]);

		if (result.conflict) {
			conflicts.push(`${field}.${key}`);
		}

		if (result.value !== undefined) {
			out[key] = result.value;
		}
	}

	if (
		local === undefined &&
		remote === undefined &&
		Object.keys(out).length === 0
	) {
		return undefined;
	}

	return out;
}

function changedFrom(
	base: Record<string, unknown>,
	side: Record<string, unknown>
): boolean {
	const keys = new Set([...Object.keys(base), ...Object.keys(side)]);

	keys.delete('deleted');

	for (const key of keys) {
		if (!deepEqual(base[key], side[key])) {
			return true;
		}
	}

	return false;
}

/**
 * `base` undefined = neither side has a common ancestor (a create the server already
 * holds): every field that differs is a change on both sides.
 */
export function merge3(
	base: LibRecord | undefined,
	local: LibRecord,
	remote: LibRecord
): MergeResult {
	const b = content(base);
	const l = content(local);
	const r = content(remote);
	const conflicts: string[] = [];
	const merged: Record<string, unknown> = {
		id: remote.id,
		type: remote.type,
		rev: remote.rev,
		by: remote.by,
		at: remote.at
	};
	const keys = new Set([
		...Object.keys(b),
		...Object.keys(l),
		...Object.keys(r)
	]);

	keys.delete('deleted');

	for (const key of [...keys].sort()) {
		let value: unknown;

		if (KEYED_FIELDS.has(key)) {
			value = mergeKeyed(key, b[key], l[key], r[key], conflicts);
		} else {
			const result = SET_FIELDS.has(key)
				? mergeSet(b[key], l[key], r[key])
				: mergeValue(b[key], l[key], r[key]);

			if (result.conflict) {
				conflicts.push(key);
			}

			value = result.value;
		}

		if (value !== undefined) {
			merged[key] = value;
		}
	}

	const baseDeleted = base ? !!base.deleted : false;
	const localDeleted = !!local.deleted;
	const remoteDeleted = !!remote.deleted;

	if (localDeleted === remoteDeleted) {
		merged.deleted = remoteDeleted;
	} else if (localDeleted !== baseDeleted && remoteDeleted === baseDeleted) {
		// Local deleted (or restored); remote did not touch `deleted`.
		merged.deleted = localDeleted;

		if (changedFrom(b, r)) {
			conflicts.push('deleted');
		}
	} else if (remoteDeleted !== baseDeleted && localDeleted === baseDeleted) {
		merged.deleted = remoteDeleted;

		if (changedFrom(b, l)) {
			conflicts.push('deleted');
		}
	} else {
		merged.deleted = remoteDeleted;
		conflicts.push('deleted');
	}

	// A delete-vs-edit conflict is one decision, not one per field: the field-level
	// conflicts beside it are still listed so a picker can show them.
	return {merged: merged as LibRecord, conflicts: conflicts.sort()};
}

/** Read `a.b` out of a record. */
export function getPath(
	record: Record<string, unknown>,
	path: string
): unknown {
	const dot = path.indexOf('.');

	if (dot < 0) {
		return record[path];
	}

	const outer = record[path.slice(0, dot)];

	return isPlainObject(outer) ? outer[path.slice(dot + 1)] : undefined;
}

/** Write `a.b` into a record, in place. `undefined` removes. */
export function setPath(
	record: Record<string, unknown>,
	path: string,
	value: unknown
): void {
	const dot = path.indexOf('.');

	if (dot < 0) {
		if (value === undefined) {
			delete record[path];
		} else {
			record[path] = value;
		}

		return;
	}

	const field = path.slice(0, dot);
	const key = path.slice(dot + 1);
	const outer = isPlainObject(record[field])
		? {...(record[field] as Record<string, unknown>)}
		: {};

	if (value === undefined) {
		delete outer[key];
	} else {
		outer[key] = value;
	}

	record[field] = outer;
}
