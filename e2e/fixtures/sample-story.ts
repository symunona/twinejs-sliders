/**
 * Sample Sliders story, authored through the Twine UI by the E2E suite.
 *
 * Deliberately exercises every scene-format feature so the E2E run doubles as an
 * acceptance test of the spec in docs/sliders/02-sliders-format.md:
 *
 *   - snapshot scene (no `from:`)      -> Tavern - Arrival
 *   - mark + patch scene (`from:@mark`)-> Tavern - Fight
 *   - patch scene + entity removal     -> Street
 *   - all three layers, flip, bare-number and [x, y] coordinates
 *   - say / set / box / wait / fx / mark beats
 *   - both link forms (inline arrow, and named with props)
 */

export interface SamplePassage {
	name: string;
	text: string;
	/** Passage names this one should link to (used to assert the story map). */
	links: string[];
}

export const SAMPLE_STORY_NAME = 'Sliders Demo';

export const SAMPLE_PASSAGES: SamplePassage[] = [
	{
		name: 'Tavern - Arrival',
		links: ['Tavern - Fight', 'Street'],
		text: `mood: tense
--
[scene]
bg: tavern-night
camera: {at: [0, 0], zoom: 1}

cast:
  mira:  {at: -0.4, pose: arms-crossed}
  joren: {at: 0.35, pose: idle, flip: true, layer: back}

props:
  # ref: points at the asset when the stage name differs from the asset name.
  candle: {at: [0.1, -0.2], layer: front, ref: candle-flicker}
  table:  {at: 0}

fx: [rain@0.6]

beats:
  - mira: "You shouldn't have come back."
  - joren: "And yet."
  - mark: tense
  - mira: {pose: angry, at: -0.25, say: "Get out."}
  - wait: 0.5
  - box: "The candle gutters."
  # Targets go inline: Twine parses [[...]] out of the passage SOURCE to draw the map
  # and auto-create passages, so a bare [[stay]] makes it invent a passage called
  # "stay". Note there are NO spaces around ->; Twine does not trim, so "[[a -> B]]"
  # would create a passage named " B". The links: map carries only presentation props.
  - mira: "Will you [[stay->Tavern - Fight]] or [[go->Street]]?"

links:
  stay: {icon: sword}
  go:   {transition: fade}

[note]
Director: she should feel cornered here. Not rendered.
`
	},
	{
		name: 'Tavern - Fight',
		links: ['Street'],
		text: `[scene]
from: Tavern - Arrival@tense

cast:
  mira: {pose: angry, at: -0.15}

beats:
  - mira: "Then draw."
  - fx: thunder
  - joren: "As you like."
  - box: "Steel on wood. [[Out into the night->Street]]"
`
	},
	{
		name: 'Street',
		links: [],
		text: `[scene]
from: Tavern - Arrival
bg: street-dusk

cast:
  joren: ~
  mira: {at: 0, pose: idle}

props:
  candle: ~
  table: ~

fx: []

beats:
  - box: "The door swings shut behind her."
  - mira: "That went well."
`
	}
];

/** A passage with deliberate errors, used to assert the parser's error reporting. */
export const BROKEN_PASSAGE: SamplePassage = {
	name: 'Broken Scene',
	links: [],
	text: `[scene]
chast:
  mira: {at: -0.4, pose: idle}
cast:
  joren: {at: 9.5, layer: middle}
`
};
