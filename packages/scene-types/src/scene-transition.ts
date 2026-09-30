/**
 * Scene transitions — how the NEXT passage arrives. One grammar for a link's `transition:`,
 * a `linkList:` default, a scene's own top-level `transition:` and the story's
 * `config.body.transition.*`, so the parser's warnings and the player's reading never
 * disagree.
 *
 * Written as a string (`push-left 0.6s in_out`, tokens in any order) or a map
 * (`{kind: push-left, dur: 0.6, ease: in_out}`). The wire keeps the string; the player
 * resolves it here at use.
 *
 * An unknown token is a warning and is skipped. A spec with no token that means anything
 * resolves to nothing, and the next layer down answers instead.
 */

import {EASES, easeValue, type EaseName} from './index';

export const SCENE_TRANSITION_KINDS = [
	'cut',
	'fade',
	'fade-dark',
	'fade-light',
	'fade-through',
	'push-left',
	'push-right',
	'push-up',
	'push-down',
	'cover-left',
	'cover-right',
	'cover-up',
	'cover-down',
	'uncover-left',
	'uncover-right',
	'uncover-up',
	'uncover-down',
	'zoom'
] as const;

export type SceneTransitionKind = (typeof SCENE_TRANSITION_KINDS)[number];

/** Other spellings. `crossfade` / `fadeInOut` are Chapbook's names for its two. */
export const SCENE_TRANSITION_ALIASES: Record<string, SceneTransitionKind> = {
	none: 'cut',
	crossfade: 'fade',
	fadeInOut: 'fade-through'
};

/** Short ease words on top of the beat `ease:` vocabulary (`EASES`, CSS keywords). */
export const SCENE_TRANSITION_EASE_ALIASES: Record<string, EaseName> = {
	in: 'ease_in',
	out: 'ease_out',
	inOut: 'ease_in_out',
	in_out: 'ease_in_out',
	'in-out': 'ease_in_out'
};

/** Keys of the map form. */
export const SCENE_TRANSITION_KEYS = ['kind', 'dur', 'ease'] as const;

/** Seconds. Longer is clamped: a passage change is not a scene. */
export const SCENE_TRANSITION_MAX_DUR = 2;

/** The curve when nobody names one. Fades linear, like every cross-fade in a beat. */
export function defaultTransitionEase(kind: SceneTransitionKind): string {
	return kind === 'cut' || kind.startsWith('fade')
		? EASES.linear
		: EASES.ease_in_out;
}

export interface SceneTransition {
	kind: SceneTransitionKind;
	/** Seconds, as written — not yet clamped. */
	dur?: number;
	/** A CSS timing function, already resolved. */
	ease?: string;
}

export interface SceneTransitionParse {
	transition?: SceneTransition;
	warnings: string[];
}

function kindOf(token: string): SceneTransitionKind | undefined {
	if ((SCENE_TRANSITION_KINDS as readonly string[]).includes(token)) {
		return token as SceneTransitionKind;
	}

	return Object.prototype.hasOwnProperty.call(SCENE_TRANSITION_ALIASES, token)
		? SCENE_TRANSITION_ALIASES[token]
		: undefined;
}

/** `0.6s`, `600ms`, or a bare number of seconds. */
export function transitionSeconds(token: unknown): number | undefined {
	if (typeof token === 'number') {
		return Number.isFinite(token) ? token : undefined;
	}

	if (typeof token !== 'string') {
		return undefined;
	}

	const match = /^(-?\d+(?:\.\d+)?|-?\.\d+)(ms|s)?$/.exec(token.trim());

	if (!match) {
		return undefined;
	}

	const n = Number(match[1]);

	return match[2] === 'ms' ? n / 1000 : n;
}

/** A transition ease word as CSS: the short words above, then the beat vocabulary. */
export function transitionEaseValue(token: string): string | undefined {
	if (
		Object.prototype.hasOwnProperty.call(SCENE_TRANSITION_EASE_ALIASES, token)
	) {
		return EASES[SCENE_TRANSITION_EASE_ALIASES[token]];
	}

	return easeValue(token);
}

/** Split on whitespace, but keep `cubic-bezier(0, 0, 1, 1)` in one piece. */
function tokens(text: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let current = '';

	for (const ch of text) {
		if (ch === '(') depth++;
		if (ch === ')') depth = Math.max(0, depth - 1);

		if (depth === 0 && /\s/.test(ch)) {
			if (current) out.push(current);
			current = '';
		} else {
			current += ch;
		}
	}

	if (current) out.push(current);
	return out;
}

const KIND_HINT = `Kinds: ${SCENE_TRANSITION_KINDS.join(', ')}.`;

/**
 * Read one spec. Never throws. `transition` is absent when nothing in it meant anything.
 *
 * A duration past `SCENE_TRANSITION_MAX_DUR` warns and is kept; the player clamps it.
 */
export function parseSceneTransition(value: unknown): SceneTransitionParse {
	const warnings: string[] = [];
	let kind: SceneTransitionKind | undefined;
	let dur: number | undefined;
	let ease: string | undefined;
	let any = false;

	const takeDur = (raw: unknown) => {
		const seconds = transitionSeconds(raw);

		if (seconds === undefined || seconds < 0) {
			warnings.push(`Bad transition duration '${String(raw)}'. Write 0.6s or 600ms.`);
			return;
		}

		if (seconds > SCENE_TRANSITION_MAX_DUR) {
			warnings.push(
				`Transition duration ${seconds}s is capped at ${SCENE_TRANSITION_MAX_DUR}s.`
			);
		}

		dur = seconds;
		any = true;
	};

	const takeEase = (raw: unknown) => {
		const css = typeof raw === 'string' ? transitionEaseValue(raw.trim()) : undefined;

		if (css === undefined) {
			warnings.push(`Unknown transition ease '${String(raw)}'.`);
			return;
		}

		ease = css;
		any = true;
	};

	const takeKind = (raw: unknown) => {
		const found = typeof raw === 'string' ? kindOf(raw.trim()) : undefined;

		if (found === undefined) {
			warnings.push(`Unknown transition '${String(raw)}'. ${KIND_HINT}`);
			return;
		}

		kind = found;
		any = true;
	};

	if (typeof value === 'number') {
		takeDur(value);
	} else if (typeof value === 'string') {
		for (const token of tokens(value)) {
			if (kindOf(token)) {
				takeKind(token);
			} else if (/^[-.\d]/.test(token)) {
				takeDur(token);
			} else if (transitionEaseValue(token) !== undefined) {
				takeEase(token);
			} else {
				warnings.push(`Unknown transition word '${token}'. ${KIND_HINT}`);
			}
		}
	} else if (value && typeof value === 'object' && !Array.isArray(value)) {
		const map = value as Record<string, unknown>;

		for (const key of Object.keys(map)) {
			if (!(SCENE_TRANSITION_KEYS as readonly string[]).includes(key)) {
				warnings.push(
					`Unknown transition key '${key}'. Keys: ${SCENE_TRANSITION_KEYS.join(', ')}.`
				);
			}
		}

		if (map.kind !== undefined && map.kind !== null) takeKind(map.kind);
		if (map.dur !== undefined && map.dur !== null) takeDur(map.dur);
		if (map.ease !== undefined && map.ease !== null) takeEase(map.ease);
	} else if (value !== undefined && value !== null) {
		warnings.push('A transition is a word like push-left, or {kind, dur, ease}.');
	}

	if (!any) {
		return {warnings};
	}

	// `transition: 1s` alone is a cross-fade that long.
	return {transition: {kind: kind ?? 'fade', dur, ease}, warnings};
}

/** The map form written back as the one-line string the wire carries. */
export function formatSceneTransition(map: {
	kind?: unknown;
	dur?: unknown;
	ease?: unknown;
}): string {
	return [
		map.kind,
		typeof map.dur === 'number' ? `${map.dur}s` : map.dur,
		map.ease
	]
		.filter(part => part !== undefined && part !== null && part !== '')
		.map(String)
		.join(' ');
}

const OPPOSITE: Record<string, string> = {
	left: 'right',
	right: 'left',
	up: 'down',
	down: 'up'
};

/**
 * The same move played backwards, for a reader stepping BACK out of a passage.
 *
 * `cover-left` brought the new page in from the right over the old; undoing it slides the
 * page off to the right again, which is `uncover-right`. Symmetric kinds are their own
 * reverse.
 */
export function reverseSceneTransition(
	kind: SceneTransitionKind
): SceneTransitionKind {
	const match = /^(push|cover|uncover)-(left|right|up|down)$/.exec(kind);

	if (!match) {
		return kind;
	}

	const [, verb, dir] = match;
	const back =
		verb === 'push' ? 'push' : verb === 'cover' ? 'uncover' : 'cover';

	return `${back}-${OPPOSITE[dir]}` as SceneTransitionKind;
}
