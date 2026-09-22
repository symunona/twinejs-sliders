/*
Parses passage text for links. Optionally, it returns internal links only --
e.g. those pointing to other passages in a story, not to an external web site.
*/

import uniq from 'lodash/uniq';

// The top level regular expression to catch links -- i.e. [[link]].
const LINK_TAG_RE = /\[\[.*?\]\]/g;

// Links _not_ starting with a protocol, e.g. abcd://.
const internalLinks = (link: string) => !/^\w+:\/\/\/?\w/i.test(link);

/**
 * Does this target name a passage rather than a web site? Exported because three other
 * places asked the same question and each wrote the regexp out again -- the story map's
 * scan, the scene-aware scan, and ctrl-click navigation.
 */
export const isInternalLink = internalLinks;

// Setter is the second [] block if exists.
const removeSetters = (link: string) => {
	const noSetter = getField(link, '][', 0);

	return noSetter ?? link;
};

const removeEnclosingBrackets = (link: string) =>
	link.substr(2, link.length - 4);

/**
 * Split the link by the separator and return the field in the given index.
 * Negative indices start from the end of the array.
 */
const getField = (link: string, separator: string, index: number) => {
	const fields = link.split(separator);

	if (fields.length === 1) {
		/* Separator not present. */
		return undefined;
	}

	return index < 0 ? fields[fields.length + index] : fields[index];
};

// Arrow links:
// [[display text->link]] format
// [[link<-display text]] format
// Interpret the rightmost '->' and the leftmost '<-' as the divider.

const extractLink = (tagContent: string) => {
	return (
		getField(tagContent, '->', -1) ||
		getField(tagContent, '<-', 0) ||
		//  TiddlyWiki links:
		//  [[display text|link]] format

		getField(tagContent, '|', -1) ||
		// [[link]] format
		tagContent
	);
};

/** One `[[…]]` tag, and where it was written. */
export interface LinkSpan {
	/**
	 * True when the tag was `[[name]]` -- no `->`, `<-` or `|`. That is the only form
	 * whose text may name an entry in a scene's `links:` block instead of a passage.
	 */
	bare: boolean;
	/** Offset just past the `]]`. */
	end: number;
	/** Offset of the `[[` within the scanned text. */
	start: number;
	/** The target, exactly as {@link parseLinks} reports it -- untrimmed, unresolved. */
	target: string;
}

/**
 * Every `[[…]]` in the text, with its offsets.
 *
 * {@link parseLinks} is derived from this rather than scanning a second time: a gesture
 * that navigates by one reading of the syntax while the map draws arrows by another is a
 * link the author can see but not follow.
 */
export function parseLinkSpans(text: string): LinkSpan[] {
	const out: LinkSpan[] = [];

	LINK_TAG_RE.lastIndex = 0;

	let match: RegExpExecArray | null;

	while ((match = LINK_TAG_RE.exec(text)) !== null) {
		// Link matching ignores setter components, should they exist.
		const body = removeSetters(removeEnclosingBrackets(match[0]));
		const target = extractLink(body);

		if (target === '') {
			continue;
		}

		out.push({
			bare: target === body,
			end: match.index + match[0].length,
			start: match.index,
			target
		});
	}

	return out;
}

/**
 * Returns a list of unique links in passage source code.
 */
export function parseLinks(text: string, internalOnly?: boolean) {
	let result = uniq(parseLinkSpans(text).map(span => span.target));

	if (internalOnly) {
		result = result.filter(internalLinks);
	}

	return result;
}
