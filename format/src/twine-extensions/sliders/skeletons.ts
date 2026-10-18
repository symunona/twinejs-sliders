/**
 * The text the Scene menu inserts.
 *
 * No YAML comments in any of it: inserted text is the author's to keep, not a manual.
 * `SCENE_SKELETON` shows every key the format understands. The editor re-points its
 * example `links:` at the passage's real links as it lands
 * (`src/dialogs/passage-edit/scene-preview/prefill-links.ts`), which relies on `links:`
 * sitting at column 0 with its entries indented under it. Keep that shape.
 */

import type {LastSceneRecord} from './last-scene';

/** Opens the block. Chapbook modifiers are a line that is nothing but `[...]`. */
const OPEN = '\n[scene]\n';

/** Closes it, so prose after the scene is prose again. */
const CLOSE = '\n\n[continued]\n';

/**
 * "Insert Empty Scene": the block and nothing in it. The editor intercepts the command and
 * writes its own copy with a `bg:` filled in (`src/dialogs/passage-edit/scene-preview/
 * empty-scene.ts`), then opens the scene editor; this bare form is what any other host
 * gets.
 */
export const EMPTY_SCENE = `${OPEN}${CLOSE}`;

export const SCENE_SKELETON = `${OPEN}from: ~
bg: backdrop-id
camera: {at: [0, 0], zoom: 1}
autoAdvance: ~

cast:
  mira:  {at: -0.4, pose: idle}
  joren: {at: 0.35, pose: idle, flip: true, layer: back, z: 2, opacity: 1}

props:
  candle: {at: [0.1, -0.2], layer: front}
  table:  {at: 0, ref: table-asset}

fx: [rain@0.6]

beats:
  - mira: "Dialogue. The bubble hangs off her anchor."
  - joren: {at: 0.3, pose: idle, say: "Move and speak in one beat."}
  - mira: {at: -0.25}
  - box: "Narration, with no speaker."
  - wait: 0.5
  - fx: thunder
  - mark: tense

links:
  onward: {to: Next Passage, if: has_weapon, icon: sword, transition: fade}
  back:   Other Passage${CLOSE}`;

export const BEATS_SNIPPET = `
beats:
  - mira: "Dialogue."
  - mira: {pose: angry, at: -0.25, say: "Dialogue and a stage change."}
  - box: "Narration, with no speaker."
  - wait: 0.5
  - mark: name-this-state
`;

export const CAST_SNIPPET = `
cast:
  mira: {at: -0.4, pose: idle}
props:
  candle: {at: [0.1, -0.2], layer: front}
`;

export const LINKS_SNIPPET = `
links:
  stay: {to: Passage Name}
  go:   {to: Other Passage, if: some_variable}
`;

/** "Insert Last Scene": the scene the author last edited, pasted as a fresh snapshot. */
export function lastSceneSnippet(record: LastSceneRecord): string {
	return `${OPEN}${record.text.replace(/^\n+|\n+$/g, '')}${CLOSE}`;
}

/** "Overlay on …": a patch scene inheriting from the last one, by its passage name. */
export function overlaySnippet(record: LastSceneRecord): string {
	const from = record.passageName ?? 'Other Passage';
	const first = record.cast?.[0] ?? 'mira';

	const lines = [
		`from: ${from}`,
		'cast:',
		`  ${first}: {at: -0.4}`,
		'beats:',
		`  - ${first}: "Say something new."`
	];

	return `${OPEN}${lines.join('\n')}${CLOSE}`;
}
