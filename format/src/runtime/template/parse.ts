import {
	VARS_SEPARATOR_SPLIT_RE,
	scanVarsLines,
	splitVarsSectionAt,
	varsConditionSource,
	varsValueSource
} from '@sliders/scene-schema';
import {createLoggers} from '../logger';
import {ParseResult, VarDeclaration} from './types';

const {log, warn} = createLoggers('parse');

const defaultOpts = {
	// The regexp matching the end of a vars section of source code. Sliders owns this rule
	// (`@sliders/scene-schema/vars-section`) so the editor's lint, the CodeMirror mode and
	// this parser cannot drift apart -- they did, and `---` was accepted by the first two
	// and silently ignored here. Only change it there.
	varsSep: VARS_SEPARATOR_SPLIT_RE,

	// The regexp matching a modifier block.
	modifierPattern: /^\[([^[].+[^\]])\]$/gm
};

/**
 * A template parser that processes text in a specific format:
 *
 * 1. An optional vars section that looks like this:
 * ```
 * var1: value
 * var2: value
 * var2 (condition): value
 * --
 * ```
 *
 * Variable names may be repeated in the vars section.
 *
 * 2. Then, a series of a mixture of plain text blocks and modifiers. Modifiers
 * exist on a single line that begins and ends with `[` and `]`. They affect the
 * following text block *only*. Text blocks are all other text.
 *
 * Modifiers can be joined on a single line by placing a semicolon between
 * them, e.g. `[modifier 1; modifier 2]`
 *
 * This returns an object with two properties:
 *
 * - `vars`: a array of `{name, condition, value}` structures, where both `condition` and
 * `value` are functions. The `condition` evaluates to whether the value should be
 * set at all, and the `value` property evaluates to the value to set.
 * - blocks: an array of {type, content} blocks
 */
export function parse(src: string, opts = defaultOpts) {
	const result: ParseResult = {
		vars: [],
		blocks: []
	};

	// Does the source start with a vars section?

	// NOT `src.split(opts.varsSep, 2)`. That ran a full split and dropped everything past
	// the second piece, so a passage with a bare `--` line anywhere in its PROSE lost the
	// rest of itself -- live, in the reader's browser. `splitVarsSectionAt` is the same
	// split point with the remainder kept whole, and it is shared with the editor so there
	// is only one copy of this to get wrong.
	const varsSplit = splitVarsSectionAt(src, opts.varsSep);
	let vars, text;

	if (varsSplit) {
		log('Detected vars section');
		({body: text, vars} = varsSplit);

		// The GRAMMAR is Sliders'; the ACTION is ours. `scanVarsLines` says what each line
		// declares, and this loop is the only thing that turns a value into a function --
		// through `varsValueSource`, the same text the lint compiles to check it. A checker
		// that builds its own string is a checker that can disagree with the runtime, which
		// is exactly how `---` was once accepted by the editor and ignored here.
		const scan = scanVarsLines(vars);

		for (const declaration of scan.declarations) {
			const {condition, name, value} = declaration;
			const thisVar: VarDeclaration = {
				name,
				value: new Function(varsValueSource(value)) as () => unknown
			};

			if (condition !== undefined) {
				thisVar.condition = new Function(
					varsConditionSource(condition)
				) as () => boolean;
				log(
					`Setting variable "${name}" to "${value}" with condition ${condition}`
				);
			} else {
				log(`Setting variable "${name}" to "${value}" without condition`);
			}

			result.vars.push(thisVar);
		}

		for (const skipped of scan.ignored) {
			warn(
				skipped.reason === 'no-colon'
					? `The line "${skipped.text}" in the vars section is missing a colon. It was ignored.`
					: `The line "${skipped.text}" in the vars section names no variable. It was ignored.`
			);
		}
	} else {
		log('No vars section detected');
		text = src;
	}

	// Scan the text for modifiers. They always begin immediately with a bracket.
	// Because of the /g flag on the modifier pattern, successive runs of exec()
	// match each instance.

	function addBlock(type: 'modifier' | 'text', content: string) {
		const trimmedContent = content.trim();

		if (trimmedContent === '') {
			return;
		}

		log(`Creating '${type}' block with content: "${trimmedContent}"`);
		result.blocks.push({type, content: trimmedContent});
	}

	const modifierPat = new RegExp(opts.modifierPattern);
	let searchIndex = 0;
	let modifierMatch = modifierPat.exec(text);

	while (modifierMatch) {
		addBlock('text', text.substring(searchIndex, modifierMatch.index));

		// Scan the modifier content for semicolons not inside quotation marks.
		// We cannot allow single quotes here because we allow modifiers such
		// as "cont'd".

		const modifierSrc = modifierMatch[1];
		let modifier = '';

		for (let i = 0; i < modifierSrc.length; i++) {
			switch (modifierSrc[i]) {
				case '"':
					// Scan ahead.

					modifier += '"';

					for (i = i + 1; i < modifierSrc.length; i++) {
						modifier += modifierSrc[i];

						if (modifierSrc[i] === '"' && modifierSrc[i - 1] !== '\\') {
							break;
						}
					}
					break;

				case ';':
					addBlock('modifier', modifier);
					modifier = '';
					break;

				default:
					modifier += modifierSrc[i];
			}
		}

		addBlock('modifier', modifier);
		searchIndex = modifierPat.lastIndex;
		modifierMatch = modifierPat.exec(text);
	}

	// We've finished parsing modifiers; put any remaining text into a final
	// block.

	addBlock('text', text.substring(searchIndex));
	return result;
}
