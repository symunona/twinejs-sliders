/**
 * Wiki-link scanning (D3, spec 02).
 *
 * Two authored forms:
 *   [[stay -> Tavern Fight]]   inline target, no props
 *   [[stay]]                   name only; the target lives in the `links:` map
 */

export interface WikiLink {
	/** The name as written, e.g. `stay`. */
	name: string;
	/** Inline target when the `->` form was used. */
	target?: string;
	/** Offset of the `[[` within the scanned string. */
	start: number;
	/** Offset just past the `]]`. */
	end: number;
}

const LINK_RE = /\[\[([^\]]*)\]\]/g;

/** Find every `[[…]]` in a string, splitting the inline `->` form. */
export function scanWikiLinks(text: string): WikiLink[] {
	const out: WikiLink[] = [];

	LINK_RE.lastIndex = 0;

	let match: RegExpExecArray | null;

	while ((match = LINK_RE.exec(text)) !== null) {
		const body = match[1];
		const arrow = body.indexOf('->');

		if (arrow === -1) {
			const name = body.trim();

			if (name !== '') {
				out.push({end: match.index + match[0].length, name, start: match.index});
			}
		} else {
			const name = body.slice(0, arrow).trim();
			const target = body.slice(arrow + 2).trim();

			if (name !== '') {
				out.push({
					end: match.index + match[0].length,
					name,
					start: match.index,
					target: target === '' ? undefined : target
				});
			}
		}
	}

	return out;
}
