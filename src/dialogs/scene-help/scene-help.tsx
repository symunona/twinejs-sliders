/**
 * The `[scene]` reference, one keypress from the passage editor.
 *
 * Every key list here is IMPORTED from the parser rather than retyped, so a key added to
 * `TOP_LEVEL_KEYS` (or `ENTITY_KEYS`, or …) fails the build until it is documented. Help
 * that drifts from the parser is worse than no help — an author trusts it and then hunts a
 * squiggle that is telling the truth.
 *
 * The prose stays English rather than going through i18n: it documents literal YAML keys
 * and worked examples in a format whose keywords are English. Only the chrome — the title
 * and the toolbar button — is translated.
 */

import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {Tab, TabList, TabPanel, Tabs} from 'react-tabs';
import {
	BEAT_COMMAND_KEYS,
	BOX_KEYS,
	CAMERA_KEYS,
	ENTITY_KEYS,
	LINK_KEYS,
	SAY_KEYS,
	TOP_LEVEL_KEYS
} from '@sliders/scene-schema';
import {
	BUBBLE_KEYS,
	BUBBLE_PLACES,
	BUBBLE_PRESETS,
	LAYERS
} from '@sliders/scene-types';
import {DEFAULT_DURATIONS} from '@sliders/scene-core';
import {DialogCard} from '../../components/container/dialog-card';
import {DialogComponentProps} from '../dialogs.types';
import {FX_IDS} from '../passage-edit/use-scene-hints';
import './scene-help.css';

/** One row of a key table. */
type KeyHelp<T extends readonly string[]> = Record<T[number], string>;

const TOP_LEVEL_HELP: KeyHelp<typeof TOP_LEVEL_KEYS> = {
	beats: 'The timeline. A list, played in order.',
	bg:
		'Backdrop, by asset name. Defaults to id:. Not a layer, never a file path. bg: ~ means none.',
	camera: `{at: [x, y], zoom: 1}. Origin is screen centre, +y is up.`,
	cast: 'Characters on stage, as id: {…} entries.',
	entities:
		'Anything on stage, as id: {…} entries, without saying whether it is a character or an asset. cast: and props: are the same thing with the kind spelled out.',
	from: 'Inherit another scene state, and become a patch over it.',
	fx: 'Screen effects, as a list.',
	id:
		'Names this scene so from: can point at it, and names its backdrop when there is no bg:. Must be unique in the story.',
	links: 'Ways out of the scene. In a scene passage these are the ONLY ways out.',
	props: 'Objects on stage. Same entry shape as cast:.'
};

const ENTITY_HELP: KeyHelp<typeof ENTITY_KEYS> = {
	at: 'Position. A bare number is x, with the feet on the stage baseline; [x, y] is both.',
	flip: 'true mirrors the sprite horizontally.',
	frame: 'Which named frame of the character to draw — idle, angry, whatever it has.',
	layer: `Legacy sugar for z:. ${LAYERS.join(', ')} — back is z: -1, front is z: 2, mid writes nothing. An explicit z: wins.`,
	of: `Hang this entity off another one: at: becomes an offset from it. of: ~ detaches.`,
	opacity: '0 to 1. 1 is the default.',
	ref: 'The asset or character this id draws, when the id is not the asset name itself.',
	scale: 'Uniform size multiplier, about the origin, so feet stay on the floor. > 0.',
	z: 'Draw order for the whole stage. Higher is nearer. Otherwise depth comes from y.'
};

const CAMERA_HELP: KeyHelp<typeof CAMERA_KEYS> = {
	at: 'Where the camera looks, in the same coordinates entities use.',
	zoom: '1 is the whole stage. Above 1 moves in.'
};

const BEAT_HELP: KeyHelp<typeof BEAT_COMMAND_KEYS> = {
	box: 'Narration, with nobody speaking.',
	fx: 'Fire an effect for this beat.',
	mark: 'Name this state so another scene can start from: it. Draws nothing.',
	wait: 'Pause, in seconds.'
};

const SAY_HELP: KeyHelp<typeof SAY_KEYS> = {
	as: 'The bubble style, by name. Shorthand for bubble: {as: …}.',
	bubble: 'Bubble style and placement, as a map. See the keys below.',
	say: 'What this entity says. Everything else in the beat is a stage change.'
};

const BOX_HELP: KeyHelp<typeof BOX_KEYS> = {
	as: 'The style, by name. Same tokens a bubble uses.',
	bubble: 'Style and placement, as a map.',
	text: 'The narration itself. box: "…" is the short way of writing this.'
};

const BUBBLE_HELP: KeyHelp<typeof BUBBLE_KEYS> = {
	as: `Style token. Ships with: ${BUBBLE_PRESETS.join(
		', '
	)}. Any other name is yours to paint in the story stylesheet.`,
	at:
		'[x, y] — the bubble\'s centre, as fractions of the stage box from its top left. Wins over place:. This is what dragging a bubble in the preview writes.',
	bg: 'Background colour. Any CSS colour.',
	color: 'Text colour.',
	font: 'Font family, e.g. Georgia, serif.',
	place: `Where the bubble sits: ${BUBBLE_PLACES.join(
		', '
	)}. auto hangs it off the speaker.`,
	size: 'Text size multiplier. 1 is the stage default.',
	w: 'Width, as a fraction of the stage width. Resizing a bubble in the preview writes this.'
};

const LINK_HELP: KeyHelp<typeof LINK_KEYS> = {
	icon: 'Icon name shown on the choice.',
	if: 'Only offer this choice when the condition holds. See the warning below.',
	to: 'Target passage name. Optional when a beat already wrote [[name->Target]].',
	transition: 'How the next passage arrives, e.g. fade.'
};

/** A YAML sample. Monospaced, never wrapped, never editable. */
const Sample: React.FC<{children: string}> = ({children}) => (
	<pre className="scene-help-sample">
		<code>{children}</code>
	</pre>
);

const KeyTable: React.FC<{
	keys: readonly string[];
	help: Record<string, string>;
}> = ({help, keys}) => (
	<table className="scene-help-keys">
		<tbody>
			{keys.map(key => (
				<tr key={key}>
					<th scope="row">{key}</th>
					<td>{help[key]}</td>
				</tr>
			))}
		</tbody>
	</table>
);

const BUBBLE_SAMPLE = `beats:
  - mira: {say: "Get out.", as: bold-italic}
  - joren: {say: "MOVE!", as: yell}
  - narrator: {say: "The lamps go out.", as: narrator, bubble: {place: top, w: 0.6}}
  - mira: {say: "Over here.", bubble: {at: [0.7, 0.25], w: 0.3}}
  - box: {text: "Somewhere, a door.", as: whisper}`;

const CONVERSATION_SAMPLE = `[scene]
id: tavern-night              # also the backdrop, with no bg: line

cast:
  mira:  {at: -0.4, frame: idle}
  joren: {at: 0.35, frame: idle, flip: true}

props:
  candle: {at: [0.1, -0.2], z: 2}

beats:
  - mira: "You shouldn't have come back."
  - joren: "And yet."
  - mira: {frame: angry, at: -0.25, say: "Get out."}
  - wait: 0.5
  - box: "The candle gutters."
  - mark: tense
  - mira: "Will you [[stay->Tavern Fight]] or [[go->Street]]?"

links:
  stay: {to: Tavern Fight, icon: sword}
  go:   {to: Street, transition: fade}

[continued]`;

const PATCH_SAMPLE = `[scene]
id: tavern-fight
from: tavern-night@tense    # or tavern-night, or tavern-night@enter
cast:
  mira: {frame: angry}      # a delta, not a whole definition
  joren: ~                  # remove him from the stage
beats:
  - mira: "Then draw."

[continued]`;

export const SceneHelpDialog: React.FC<DialogComponentProps> = props => {
	const {t} = useTranslation();

	return (
		<DialogCard
			{...props}
			className="scene-help-dialog"
			headerLabel={t('dialogs.sceneHelp.title')}
			maximizable
		>
			<div className="scene-help">
				{/* Top of the window on purpose: it is the one thing that saves typing in
				    every single section below. */}
				<p className="scene-help-hotkey">
					<kbd>Ctrl</kbd> + <kbd>Space</kbd> — pick a name instead of typing it.
					Inside a <code>[scene]</code> block it offers what the cursor is
					standing in: backdrops after <code>bg:</code>, characters under{' '}
					<code>cast:</code>, assets under <code>props:</code>, a character&apos;s own
					frames after <code>frame:</code>, layers, effects, and passage names
					after <code>to:</code>. Inside <code>[[…]]</code> anywhere in the
					passage it offers passage names.
				</p>
				{/* Same tab classes the asset and character dialogs use, restyled
				    locally so this dialog does not depend on their CSS. */}
				<Tabs selectedTabClassName="selected">
					<TabList className="sliders-tablist">
						{[
							'Scene',
							'Stage',
							'Characters',
							'Beats',
							'Animation',
							'Links',
							'Reuse'
						].map(label => (
							<Tab className="sliders-tab" key={label}>
								{label}
							</Tab>
						))}
					</TabList>

					<TabPanel>
						<p>
							A passage with a <code>[scene]</code> block in it IS that scene:
							the stage fills the screen and everything outside the block is
							dropped before rendering. One block per passage, ended by{' '}
							<code>[continued]</code> if the passage carries anything else.
						</p>
						<p>
							The block is a snapshot, not a list of commands — it states the
							whole stage, and the engine works out the animation by diffing
							against the stage before it. That is what makes a block
							copy-pasteable.
						</p>
						<KeyTable keys={TOP_LEVEL_KEYS} help={TOP_LEVEL_HELP} />
						<Sample>{CONVERSATION_SAMPLE}</Sample>
					</TabPanel>

					<TabPanel>
						<h3>Entity keys</h3>
						<p>
							Every entry under <code>cast:</code>, <code>props:</code> and{' '}
							<code>entities:</code> takes these. All three share one id space, so
							a prop can hang off a character.
						</p>
						<KeyTable keys={ENTITY_KEYS} help={ENTITY_HELP} />
						<h3>Coordinates</h3>
						<ul>
							<li>Origin is screen centre. x: −1 is the left edge, +1 the right.</li>
							<li>y is UP. Units are normalized, never pixels.</li>
							<li>
								A character&apos;s origin is its FEET: <code>at: 0</code> stands
								centre stage, it does not float.
							</li>
							<li>
								On an entity with <code>of:</code>, a bare <code>at:</code> is
								an x offset and stays level with the parent — not on the floor.
							</li>
						</ul>
						<Sample>{`props:
  table:  {at: -0.3}
  candle: {of: table, at: [0.1, 0.2], z: 2}   # rides with the table`}</Sample>
						<h3>Depth</h3>
						<p>
							One number for the whole stage. Lower on screen draws nearer, so
							depth normally comes from <code>y</code> and lands in 0 to 1;{' '}
							<code>z:</code> overrides that, and nothing partitions it — a{' '}
							<code>z: 2</code> prop is in front of every character. Two sprites
							at the same depth draw in the order they are written. Bubbles sit
							above all of it. The old <code>layer:</code> key still reads, as
							sugar for a <code>z</code> seed.
						</p>
						<h3>Camera</h3>
						<KeyTable keys={CAMERA_KEYS} help={CAMERA_HELP} />
						<Sample>{`camera: {at: [0, 0], zoom: 1}`}</Sample>
					</TabPanel>

					<TabPanel>
						<h3>Adding a character</h3>
						<ol>
							<li>
								Story toolbar ▸ <strong>Characters</strong> ▸{' '}
								<strong>New Character</strong>. The id you give it is the name
								scenes use.
							</li>
							<li>
								Add a <strong>frame</strong> per expression or pose — idle,
								angry, wave — each one an image. An animated GIF or WebP just
								plays; there is no sprite sheet and no frame scheduler.
							</li>
							<li>
								Set the frame&apos;s <strong>anchors</strong>: <code>bubble</code>{' '}
								is where dialogue hangs off them. Anchors are fractions of the
								frame, so they survive a change of resolution.
							</li>
							<li>
								Back in the scene, put them on stage:{' '}
								<code>cast:</code> then the id.
							</li>
						</ol>
						<Sample>{`cast:
  mira:  {at: -0.4, frame: idle}
  joren: {at: 0.35, frame: idle, flip: true, z: -1}`}</Sample>
						<p>
							Props work the same way but come from the asset library rather
							than the character editor. Dragging an image onto the preview adds
							it for you, and dragging a sprite around the preview writes its{' '}
							<code>at:</code> back into the YAML.
						</p>
						<p>
							An id that is not the asset&apos;s own name needs <code>ref:</code>:{' '}
							<code>{`table: {at: 0, ref: oak-table}`}</code>.
						</p>
					</TabPanel>

					<TabPanel>
						<h3>Beats</h3>
						<p>
							<code>beats:</code> is a list, played top to bottom. A speaker id
							as the key means that character speaks.
						</p>
						<table className="scene-help-keys">
							<tbody>
								<tr>
									<th scope="row">- mira: &quot;text&quot;</th>
									<td>Mira speaks. The bubble hangs off her bubble anchor.</td>
								</tr>
								<tr>
									<th scope="row">
										- mira: {'{'}at: -0.25, say: &quot;text&quot;{'}'}
									</th>
									<td>
										Move, change frame, and speak in one beat. Any entity key
										works alongside <code>say:</code>.
									</td>
								</tr>
								{BEAT_COMMAND_KEYS.map(key => (
									<tr key={key}>
										<th scope="row">- {key}: …</th>
										<td>{BEAT_HELP[key]}</td>
									</tr>
								))}
							</tbody>
						</table>
						<h3>Speaking</h3>
						<KeyTable keys={SAY_KEYS} help={SAY_HELP} />
						<h3>Narration, the long way</h3>
						<p>
							<code>box: &quot;text&quot;</code> is the short form. Written as a
							map it takes a style too.
						</p>
						<KeyTable keys={BOX_KEYS} help={BOX_HELP} />
						<h3>Bubble style and placement</h3>
						<p>
							A character can carry its own defaults in the character editor; a
							beat&apos;s own keys merge over them. Styles the renderer does not
							ship CSS for still reach the page as{' '}
							<code>data-style=&quot;name&quot;</code>, so the story stylesheet
							can paint anything.
						</p>
						<KeyTable keys={BUBBLE_KEYS} help={BUBBLE_HELP} />
						<Sample>{BUBBLE_SAMPLE}</Sample>
						<h3>A conversation</h3>
						<Sample>{CONVERSATION_SAMPLE}</Sample>
					</TabPanel>

					<TabPanel>
						<h3>Animation is derived, not authored</h3>
						<p>
							Nothing in the block says &quot;move&quot;. Each beat is a new
							snapshot, and the engine diffs it against the one before to decide
							what animates and for how long. Write where things ARE; the walk
							between comes free.
						</p>
						<table className="scene-help-keys">
							<tbody>
								{Object.entries(DEFAULT_DURATIONS).map(([kind, seconds]) => (
									<tr key={kind}>
										<th scope="row">{kind}</th>
										<td>{seconds}s by default</td>
									</tr>
								))}
							</tbody>
						</table>
						<p>
							A character&apos;s own motion is the frame image itself — an animated
							GIF or WebP loops on its own.
						</p>
						<h3>Effects</h3>
						<p>
							<code>fx:</code> takes a list, either <code>name@amount</code> or{' '}
							<code>{`{id: name, amount: 0.6}`}</code>. A beat can fire one too.
							Known effects: {FX_IDS.join(', ')}.
						</p>
						<Sample>{`fx: [rain@0.6, cold@0.3]

beats:
  - fx: flash
  - wait: 0.4`}</Sample>
					</TabPanel>

					<TabPanel>
						<h3>Link keys</h3>
						<KeyTable keys={LINK_KEYS} help={LINK_HELP} />
						<Sample>{`links:
  stay: {to: Tavern Fight, if: has_weapon, icon: sword, transition: fade}
  go:   Street                # shorthand when the target is all you need`}</Sample>
						<p>
							In a scene passage, a <code>[[link]]</code> written outside the
							block is not drawn — every way out has to be in{' '}
							<code>links:</code>. Insert Scene fills these in from the links the
							passage already had.
						</p>
						<h3>Write the target inline</h3>
						<p>
							Twine reads <code>[[…]]</code> out of the passage source to draw
							the story map, so write <code>[[stay-&gt;Tavern Fight]]</code>, not
							a bare <code>[[stay]]</code> — and with{' '}
							<strong>no spaces around the arrow</strong>, because Twine does not
							trim the target.
						</p>
						<h3>
							<code>if:</code> needs a variable something sets
						</h3>
						<p>
							A condition names a Chapbook variable. Variables are set in a vars
							section: <code>name: value</code> lines above a <code>--</code>{' '}
							line at the top of a passage. A condition that names a variable no
							passage sets is underlined as an error — including the one in the
							Insert Scene example, until you set it or drop it.
						</p>
						<Sample>{`has_weapon: true
--
[scene]
links:
  stay: {to: Tavern Fight, if: has_weapon}

[continued]`}</Sample>
					</TabPanel>

					<TabPanel>
						<h3>id, from, mark</h3>
						<p>
							A scene with an <code>id:</code> can be started from. A scene with{' '}
							<code>from:</code> is a PATCH over that state instead of a
							snapshot, which flips what an absent key means: without{' '}
							<code>from:</code> it is removed from the stage, with it, it is
							inherited unchanged.
						</p>
						<table className="scene-help-keys">
							<tbody>
								<tr>
									<th scope="row">tavern-night</th>
									<td>That scene&apos;s state after its last beat.</td>
								</tr>
								<tr>
									<th scope="row">tavern-night@enter</th>
									<td>Its state before any beat ran.</td>
								</tr>
								<tr>
									<th scope="row">tavern-night@tense</th>
									<td>
										Its state at the beat marked <code>mark: tense</code>.
									</td>
								</tr>
							</tbody>
						</table>
						<Sample>{PATCH_SAMPLE}</Sample>
						<p>
							The toolbar writes these: <strong>Scene ▸ Overlay on …</strong>{' '}
							inserts a patch pointing at the last scene you named, and{' '}
							<strong>Scene ▸ Insert Last Scene</strong> inserts a copy of it
							minus the <code>id:</code>, since ids are global.
						</p>
					</TabPanel>
				</Tabs>
			</div>
		</DialogCard>
	);
};
