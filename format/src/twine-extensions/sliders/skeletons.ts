/**
 * The text the Scene menu inserts.
 *
 * `SCENE_SKELETON` is the teaching document: every key the format understands, with the
 * comment that says what it is for. The editor re-points its example `links:` at the
 * passage's real links as it lands (`src/dialogs/passage-edit/scene-preview/prefill-links.ts`),
 * which relies on `links:` sitting at column 0 with its entries indented under it. Keep
 * that shape.
 */

import type {LastSceneRecord} from './last-scene';

/** Opens the block. Chapbook modifiers are a line that is nothing but `[...]`. */
const OPEN = '\n[scene]\n';

/** Closes it, so prose after the scene is prose again. */
const CLOSE = '\n\n[continued]\n';

export const SCENE_SKELETON = `${OPEN}# Every key Sliders understands. Delete the ones you do not need.
id: scene-id                    # globally unique; needed only if something points here
from: ~                         # inherit: other-scene, other-scene@enter, other-scene@mark-name
bg: backdrop-id                 # asset id, never a path
camera: {at: [0, 0], zoom: 1}   # origin is screen centre, +y is UP

cast:
  mira:  {at: -0.4, frame: idle}
  joren: {at: 0.35, frame: idle, flip: true, layer: back, z: 2, opacity: 1}

props:
  candle: {at: [0.1, -0.2], layer: front}
  table:  {at: 0, ref: table-asset}   # ref: when the id is not the asset id

fx: [rain@0.6]                  # name@amount, or {id: rain, amount: 0.6}

beats:
  - mira: "Dialogue. The bubble hangs off her anchor."
  - joren: {at: 0.3, frame: idle, say: "Move and speak in one beat."}
  - mira: {at: -0.25}           # stage change, nobody speaks
  - box: "Narration, with no speaker."
  - wait: 0.5                   # seconds
  - fx: thunder
  - mark: tense                 # names this state so from: can target it
  # A choice is a wiki link in dialogue: the link name, an arrow, and the target
  # passage, wrapped in doubled square brackets. Props for it go under links:.

links:
  onward: {to: Next Passage, if: has_weapon, icon: sword, transition: fade}
  back:   Other Passage         # shorthand when the target is all you need${CLOSE}`;

export const BEATS_SNIPPET = `
beats:
  - mira: "Dialogue."
  - mira: {frame: angry, at: -0.25, say: "Dialogue and a stage change."}
  - box: "Narration, with no speaker."
  - wait: 0.5
  - mark: name-this-state
`;

export const CAST_SNIPPET = `
cast:
  mira: {at: -0.4, frame: idle}
props:
  candle: {at: [0.1, -0.2], layer: front}
`;

export const LINKS_SNIPPET = `
links:
  stay: {to: Passage Name}
  go:   {to: Other Passage, if: some_variable}
`;

/**
 * A scene id is global, so a copy cannot keep the original's. Dropping the line is better
 * than inventing a name: an anonymous scene is legal, a duplicate id is not.
 */
function withoutId(text: string): string {
	return text
		.split('\n')
		.filter(line => !/^id\s*:/.test(line))
		.join('\n')
		.replace(/^\n+|\n+$/g, '');
}

/** "Insert Last Scene": the scene the author last edited, pasted as a fresh snapshot. */
export function lastSceneSnippet(record: LastSceneRecord): string {
	const heading = record.id
		? `# Copy of scene '${record.id}'. Give this one an id: if anything will point at it.`
		: '# Copy of the last scene you edited.';

	return `${OPEN}${heading}\n${withoutId(record.text)}${CLOSE}`;
}

/**
 * "Overlay on …": a patch scene inheriting from the last named one. Lists the cast and
 * props it inherits as comments, because the whole point of a patch is that what it does
 * not mention is still on stage.
 */
export function overlaySnippet(record: LastSceneRecord): string {
	const id = record.id ?? 'scene-id';
	const cast = record.cast ?? [];
	const props = record.props ?? [];
	const first = cast[0] ?? 'mira';

	const lines = [
		`id: ${id}-next`,
		`from: ${id}   # its EXIT state. Use ${id}@enter, or ${id}@mark-name.`,
		'# A patch, not a snapshot: every key you leave out is INHERITED.',
		`# \`${first}: ~\` removes an entity. \`cast: !only {...}\` replaces the whole cast.`,
		...(cast.length > 0 ? [`# Inherited cast: ${cast.join(', ')}`] : []),
		...(props.length > 0 ? [`# Inherited props: ${props.join(', ')}`] : []),
		'cast:',
		`  ${first}: {at: -0.4}   # deltas only`,
		'beats:',
		`  - ${first}: "Say something new."`
	];

	return `${OPEN}${lines.join('\n')}${CLOSE}`;
}
