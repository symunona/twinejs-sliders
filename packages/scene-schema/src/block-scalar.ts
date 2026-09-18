/**
 * Ragged block scalars: `key: |` followed by lines that do not all share one indent.
 *
 * A block scalar's indent is set by its FIRST non-empty line. A later line indented less
 * than that ends the scalar — and since it is still deeper than the key that opened it, it
 * lands at an indent YAML cannot place anything at. What the author sees is a pile of
 * errors, none of which mentions indentation:
 *
 *     - bob: |
 *             [[Pub->pub]]
 *           [[Walk->walk]]?
 *
 *   All mapping items must start at the same column
 *   Unexpected explicit-key-ind at node end
 *   Implicit map keys need to be followed by map values
 *   A beat has exactly one key. Split this into two beats.
 *
 * The last one is the worst of them: it describes a beat the author never wrote. So this
 * runs over the TEXT, before the document is parsed, and `parseScene` replaces everything
 * reported on such a line with the one error that names the mistake.
 */

/** A line that fell out of the block scalar above it. */
export interface RaggedBlockLine {
	/** Indent, in spaces, that the block's other lines use. */
	blockIndent: number;
	/** 1-indexed, first column of the line's text. */
	col: number;
	/** The line's current leading whitespace, verbatim: what a fix must replace. */
	indentText: string;
	/** The key that opened the block, for the message. */
	key: string;
	/** 1-indexed. */
	line: number;
}

/**
 * A block scalar header: `key: |`, `- key: >-`, `key: |2 # why`.
 *
 * The indicator has to end the line (a comment aside) — that is what makes this a header
 * rather than a value that happens to contain a `>`.
 */
const HEADER =
	/^([ \t]*)((?:-[ \t]+)*)(.+?):[ \t]*[|>][+-]?[0-9]*[ \t]*(?:#.*)?$/;

function indentOf(line: string): number {
	return line.length - line.trimStart().length;
}

function keyText(raw: string): string {
	const trimmed = raw.trim();

	return /^(["']).*\1$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

export function raggedBlockLines(text: string): RaggedBlockLine[] {
	const lines = text.split('\n');
	const out: RaggedBlockLine[] = [];

	for (let i = 0; i < lines.length; i++) {
		const header = HEADER.exec(lines[i]);

		if (header === null) {
			continue;
		}

		// Where the key itself starts. A line indented this far or less is a sibling or a
		// parent — it ends the scalar the way the author meant it to.
		const openIndent = header[1].length + header[2].length;
		let blockIndent: number | undefined;

		for (let j = i + 1; j < lines.length; j++) {
			const line = lines[j];

			if (line.trim() === '') {
				continue; // A blank line keeps the block open, whatever it is indented to.
			}

			const indent = indentOf(line);

			if (indent <= openIndent) {
				break;
			}

			if (blockIndent === undefined) {
				blockIndent = indent; // The first line is the one that sets the rule.
				continue;
			}

			if (indent < blockIndent) {
				out.push({
					blockIndent,
					col: indent + 1,
					indentText: line.slice(0, indent),
					key: keyText(header[3]),
					line: j + 1
				});
			}
		}
	}

	return out;
}
