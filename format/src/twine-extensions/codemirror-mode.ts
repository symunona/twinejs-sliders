import {Mode} from 'codemirror';
import {
	SCENE_MODIFIER_LINE,
	SceneModeState,
	sceneToken
} from './sliders/scene-mode';

interface ChapbookModeState extends SceneModeState {
	hasVarsSection?: boolean;
	inVarsSection?: boolean;
}

export function mode(): Mode<ChapbookModeState> {
	return {
		startState() {
			return {flowDepth: 0, inScene: false, inVarsSection: false};
		},
		token(stream, state) {
			if (state.hasVarsSection === undefined) {
				// Scan forward to see if there's any vars section at all.

				for (
					let i = 1, nextLine = stream.lookAhead(1);
					nextLine && state.hasVarsSection === undefined;
					nextLine = stream.lookAhead(++i)
				) {
					if (nextLine === '--') {
						state.hasVarsSection = true;
						state.inVarsSection = true;
					}
				}

				// If we didn't find it already, it doesn't exist.

				if (state.hasVarsSection === undefined) {
					state.hasVarsSection = false;
				}
			}

			if (state.hasVarsSection && state.inVarsSection) {
				// We're in the vars section.

				if (stream.sol()) {
					if (stream.match(/^--$/)) {
						state.inVarsSection = false;
						stream.skipToEnd();
						return 'punctuation';
					} else {
						if (stream.skipTo(':')) {
							stream.next();
							return 'def';
						}

						// The line is malformed.

						stream.skipToEnd();
						return 'text';
					}
				}
			}

			// We're inside a [scene] block: YAML, not prose. `sceneToken` clears
			// `inScene` itself when it meets the modifier that closes the block, and
			// returns null for that line so the code below can style it.

			if (state.inScene) {
				const style = sceneToken(stream, state);

				if (state.inScene || style !== null) {
					return style;
				}
			}

			// We're in body text.

			// Modifiers are on a line by themselves.

			if (stream.sol() && stream.match(/^\[[^[].*\]$/)) {
				state.inScene = SCENE_MODIFIER_LINE.test(stream.current());
				return 'keyword';
			}

			// Are we at an insert?

			if (stream.match(/^\{.+?\}/)) {
				return 'keyword';
			}

			// Are we at a link?

			if (stream.match(/^\[\[[^\]]+?\]\]/)) {
				return 'link';
			}

			// Try scanning forward to an insert or link.

			if (stream.eatWhile(/[^[{]/)) {
				return 'text';
			}

			// If not, the line just holds plain text.

			stream.skipToEnd();
			return 'text';
		}
	};
}
