/**
 * Caret <-> selection. Both directions run off the same node ranges the writers use, so
 * "click the sprite, land on its line" and "put the caret on the line, highlight the
 * sprite" can never disagree about where an entity lives.
 */

import {isMap} from 'yaml';
import type {Pair, YAMLMap} from 'yaml';
import type {EntityKind} from '@sliders/scene-types';
import {
	BEAT_COMMANDS,
	beatsSeqOf,
	entityMapOf,
	findPair,
	keyName,
	locateEntity,
	pairEnd,
	parseBlock,
	rangeOf,
	trimEnd,
	type Parsed
} from './locate';
import type {EntityTarget, LineSpan} from './types';

function lineAt(parsed: Parsed, offset: number): number {
	const clamped = Math.max(0, Math.min(parsed.text.length, offset));

	return parsed.lineCounter.linePos(clamped).line;
}

function pairSpan(
	parsed: Parsed,
	pair: Pair<unknown, unknown>
): LineSpan | undefined {
	const keyRange = rangeOf(pair.key);
	const end = pairEnd(pair);

	if (!keyRange || end === undefined) {
		return undefined;
	}

	// A node range ends one PAST the last character, and for a block value that character
	// is often the newline — so the raw end lands on the following line and the highlight
	// spills over the next entity.
	const last = trimEnd(parsed.text, end, keyRange[0]);
	const start = lineAt(parsed, keyRange[0]);

	return {
		end: Math.max(start, lineAt(parsed, Math.max(keyRange[0], last - 1))),
		start
	};
}

/**
 * A beat speaker is a cast member unless `entities:` or the `props:` map says otherwise. A
 * patch scene
 * inherits entities it never names locally, so "not declared here" cannot mean "not a
 * character" — defaulting to prop would break every `from:` scene.
 */
function kindOfId(parsed: Parsed, id: string): EntityKind {
	const entities = entityMapOf(parsed, 'auto');

	if (entities && findPair(entities, id)) {
		return 'auto';
	}

	const props = entityMapOf(parsed, 'prop');

	return props && findPair(props, id) ? 'prop' : 'cast';
}

/** Which entity a 1-indexed line inside the block belongs to. */
export function entityAtLine(
	text: string,
	line: number
): EntityTarget | undefined {
	const parsed = parseBlock(text);

	if (!parsed) {
		return undefined;
	}

	for (const kind of ['cast', 'prop', 'auto'] as const) {
		const map = entityMapOf(parsed, kind);

		if (!map) {
			continue;
		}

		for (const pair of map.items as Pair<unknown, unknown>[]) {
			const id = keyName(pair);
			const span = id === undefined ? undefined : pairSpan(parsed, pair);

			if (span && line >= span.start && line <= span.end) {
				return {id: id as string, kind};
			}
		}
	}

	const beats = beatsSeqOf(parsed);

	for (let index = 0; index < (beats?.items.length ?? 0); index++) {
		const item = beats?.items[index];

		if (!isMap(item)) {
			continue;
		}

		const first = (item as YAMLMap).items[0] as
			Pair<unknown, unknown> | undefined;
		const span = first && pairSpan(parsed, first);

		if (!span || line < span.start || line > span.end) {
			continue;
		}

		const id = keyName(first as Pair<unknown, unknown>);

		// `- wait: 0.5` is a command, not a speaker. Returning a target named `wait` would
		// have the overlay hunt for a sprite that cannot exist.
		if (id === undefined || (BEAT_COMMANDS as readonly string[]).includes(id)) {
			return undefined;
		}

		return {beat: index, id, kind: kindOfId(parsed, id)};
	}

	return undefined;
}

/** The 1-indexed line range an entity entry occupies. */
export function entityLines(
	text: string,
	target: EntityTarget
): LineSpan | undefined {
	const parsed = parseBlock(text);

	if (!parsed) {
		return undefined;
	}

	const located = locateEntity(parsed, target);

	return located ? pairSpan(parsed, located.pair) : undefined;
}
