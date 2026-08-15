/**
 * Tiny edit-distance helper, used to turn `unknown-key` errors into actionable hints
 * ("Did you mean 'cast'?"). Spec 05 asks for "suggest via edit distance".
 */

/** Classic Levenshtein distance, two-row DP. */
export function levenshtein(a: string, b: string): number {
	if (a === b) {
		return 0;
	}

	if (a.length === 0) {
		return b.length;
	}

	if (b.length === 0) {
		return a.length;
	}

	let prev = new Array<number>(b.length + 1);
	let curr = new Array<number>(b.length + 1);

	for (let j = 0; j <= b.length; j++) {
		prev[j] = j;
	}

	for (let i = 1; i <= a.length; i++) {
		curr[0] = i;

		for (let j = 1; j <= b.length; j++) {
			const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;

			curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
		}

		const swap = prev;

		prev = curr;
		curr = swap;
	}

	return prev[b.length];
}

/**
 * Closest candidate to `input`, or undefined when nothing is close enough to be worth
 * suggesting. Case-insensitive: `Cast` should suggest `cast`.
 */
export function nearestKey(
	input: string,
	candidates: readonly string[]
): string | undefined {
	const needle = input.toLowerCase();
	let best: string | undefined;
	let bestDistance = Infinity;

	for (const candidate of candidates) {
		const distance = levenshtein(needle, candidate.toLowerCase());

		if (distance < bestDistance) {
			bestDistance = distance;
			best = candidate;
		}
	}

	if (best === undefined) {
		return undefined;
	}

	// Suggesting a three-edit fix for a two-letter typo is noise, so scale the tolerance
	// with the length of what was actually typed.
	const tolerance = Math.max(1, Math.min(3, Math.ceil(needle.length / 2)));

	if (bestDistance <= tolerance) {
		return best;
	}

	// A shared first letter is strong evidence of a typo rather than a different word, and
	// it is what makes spec 05's own example work: 'char' -> 'cast' is three edits.
	if (
		bestDistance <= 3 &&
		needle.length >= 3 &&
		best[0].toLowerCase() === needle[0]
	) {
		return best;
	}

	return undefined;
}

/** `Unknown key 'x'.` + `Did you mean 'y'?`, ready to drop into a SceneError. */
export function keyHint(
	input: string,
	candidates: readonly string[]
): string | undefined {
	const nearest = nearestKey(input, candidates);

	return nearest === undefined ? undefined : `Did you mean '${nearest}'?`;
}
