/**
 * The tool surface, spec'd once (voice-mode plan §5).
 *
 * The set is lifted from `twine-cli` rather than invented: `map`, `cat`, `put`, `lint` is
 * already an agent-shaped command set that a year of CLI use has sanded down. What is new
 * is the UI tier — a model that edits a story the author is watching has to move the
 * author's eyes to the edit first, or the change lands off screen and the session becomes
 * an argument about what just happened.
 *
 * `restore` is deliberately NOT here. Restoring is the author's button. A microphone that
 * can roll the whole story back is a microphone that can lose an afternoon.
 */

import type {VoiceToolDecl} from './voice.types';

const REF = {
	description:
		'Passage name (case-insensitive) or passage id. Prefer the name the author says.',
	type: 'string'
} as const;

const SCENE = {
	description:
		'The passage the scene lives in, by name (case-insensitive). A scene has no other name.',
	type: 'string'
} as const;

export const voiceTools: VoiceToolDecl[] = [
	// --- read --------------------------------------------------------------
	{
		description:
			'The story map: every passage with its line count, links and scene block, plus the scene list, asset tally and lint count. Read this before deciding anything. It is refreshed after every write.',
		kind: 'read',
		name: 'map',
		parameters: {properties: {}, type: 'object'}
	},
	{
		description:
			'The full text of one passage, with its tags and where its scene block starts.',
		kind: 'read',
		name: 'read_passage',
		parameters: {properties: {ref: REF}, required: ['ref'], type: 'object'}
	},
	{
		description:
			'One scene, parsed: beats, cast, props, backdrop and marks. Use it to answer questions about a scene; use read_passage when you are about to edit the text.',
		kind: 'read',
		name: 'read_scene',
		parameters: {
			properties: {
				scene: SCENE
			},
			required: ['scene'],
			type: 'object'
		}
	},
	{
		description:
			'Lint errors and warnings, as file:line. Omit ref to lint the whole story.',
		kind: 'read',
		name: 'lint',
		parameters: {properties: {ref: REF}, type: 'object'}
	},
	{
		description: 'The link graph as edges, optionally walked from one passage.',
		kind: 'read',
		name: 'graph',
		parameters: {
			properties: {
				depth: {description: 'How far to walk. Default: all.', type: 'integer'},
				from: REF
			},
			type: 'object'
		}
	},
	{
		description:
			'Assets in this story’s library, with which scenes reach each one. Pass scene to list only what that scene needs.',
		kind: 'read',
		name: 'list_assets',
		parameters: {
			properties: {scene: SCENE},
			type: 'object'
		}
	},
	{
		description: 'Find an asset by a fragment of its name.',
		kind: 'read',
		name: 'find_asset',
		parameters: {
			properties: {q: {type: 'string'}},
			required: ['q'],
			type: 'object'
		}
	},
	{
		description:
			'Look at the rendered scene. Returns a picture of the real preview standing on a beat. Ask for this when the author describes something visual — a position, a size, whether a character is hidden behind a prop. One per turn.',
		kind: 'read',
		name: 'screenshot_scene',
		parameters: {
			properties: {
				beat: {
					description: 'Beat index to stand on. Default: the opening state.',
					type: 'integer'
				},
				ref: REF
			},
			required: ['ref'],
			type: 'object'
		}
	},

	// --- write -------------------------------------------------------------
	{
		description:
			'Replace a passage’s whole text. You must read_passage it first in this session — a blind write is rejected.',
		kind: 'write',
		name: 'write_passage',
		parameters: {
			properties: {ref: REF, text: {type: 'string'}},
			required: ['ref', 'text'],
			type: 'object'
		}
	},
	{
		description: 'Create a passage. Position is chosen for you unless you give one.',
		kind: 'write',
		name: 'create_passage',
		parameters: {
			properties: {
				at: {
					description: '[left, top] in story coordinates.',
					items: {type: 'number'},
					type: 'array'
				},
				name: {type: 'string'},
				text: {type: 'string'}
			},
			required: ['name'],
			type: 'object'
		}
	},
	{
		description: 'Delete a passage. Undoable like any other change.',
		kind: 'write',
		name: 'delete_passage',
		parameters: {properties: {ref: REF}, required: ['ref'], type: 'object'}
	},
	{
		description:
			'Rename a passage. Inbound links are rewritten, the same as when the author renames it.',
		kind: 'write',
		name: 'rename_passage',
		parameters: {
			properties: {name: {type: 'string'}, ref: REF},
			required: ['ref', 'name'],
			type: 'object'
		}
	},
	{
		description: 'Add and/or remove tags on a passage.',
		kind: 'write',
		name: 'tag_passage',
		parameters: {
			properties: {
				add: {items: {type: 'string'}, type: 'array'},
				ref: REF,
				remove: {items: {type: 'string'}, type: 'array'}
			},
			required: ['ref'],
			type: 'object'
		}
	},
	{
		description:
			'Change scene keys surgically — backdrop, camera, cast and prop entries. Send only the keys you are changing, as YAML. The author’s formatting and comments are kept. Beats are not accepted here; use set_beat.',
		kind: 'write',
		name: 'patch_scene',
		parameters: {
			properties: {
				scene: SCENE,
				yaml: {
					description:
						'A YAML map of the keys to change, e.g. "bg: tavern/dawn" or "cast:\\n  mara: {at: [0.4, 0.9]}". A key set to ~ is removed.',
					type: 'string'
				}
			},
			required: ['scene', 'yaml'],
			type: 'object'
		}
	},
	{
		description:
			'Change one beat, by index, surgically. The patch is a YAML map of beat keys.',
		kind: 'write',
		name: 'set_beat',
		parameters: {
			properties: {
				beat: {description: '0-based index into `beats:`.', type: 'integer'},
				patch: {description: 'YAML map of keys to set. ~ removes.', type: 'string'},
				scene: SCENE
			},
			required: ['scene', 'beat', 'patch'],
			type: 'object'
		}
	},
	{
		description:
			'Link one passage to another, creating the target if it does not exist yet.',
		kind: 'write',
		name: 'link',
		parameters: {
			properties: {from: REF, to: {type: 'string'}},
			required: ['from', 'to'],
			type: 'object'
		}
	},
	{
		description:
			'Replace text across the story, or inside one passage. Plain text, not a regexp.',
		kind: 'write',
		name: 'find_replace',
		parameters: {
			properties: {
				q: {type: 'string'},
				scope: {...REF, description: 'One passage. Omit for the whole story.'},
				with: {type: 'string'}
			},
			required: ['q', 'with'],
			type: 'object'
		}
	},

	// --- ui ----------------------------------------------------------------
	{
		description:
			'Select a passage and scroll it into view. Call this before every edit, so the author is looking at what changes.',
		kind: 'ui',
		name: 'goto',
		parameters: {properties: {ref: REF}, required: ['ref'], type: 'object'}
	},
	{
		description:
			'Open the scene preview on a passage, optionally standing on a beat. Do this whenever you edit a scene.',
		kind: 'ui',
		name: 'open_preview',
		parameters: {
			properties: {beat: {type: 'integer'}, ref: REF},
			required: ['ref'],
			type: 'object'
		}
	},
	{
		description: 'Open the passage editor, for when the author should type.',
		kind: 'ui',
		name: 'open_passage_editor',
		parameters: {properties: {ref: REF}, required: ['ref'], type: 'object'}
	},
	{
		description:
			'Highlight passages on the map — for "these three are orphans" and the like.',
		kind: 'ui',
		name: 'highlight',
		parameters: {
			properties: {refs: {items: {type: 'string'}, type: 'array'}},
			required: ['refs'],
			type: 'object'
		}
	},

	// --- history -----------------------------------------------------------
	{
		description:
			'Pin the current revision with a label, so the author can find their way back to it.',
		kind: 'ui',
		name: 'checkpoint',
		parameters: {
			properties: {label: {type: 'string'}},
			required: ['label'],
			type: 'object'
		}
	},
	{
		description: 'Recent revisions with their labels.',
		kind: 'read',
		name: 'revs',
		parameters: {properties: {}, type: 'object'}
	}
];

export const voiceToolsByName = new Map(
	voiceTools.map(tool => [tool.name, tool] as const)
);

/** Every tool that writes. The panel colours these rows and offers the undo. */
export function isWriteTool(name: string): boolean {
	return voiceToolsByName.get(name)?.kind === 'write';
}
