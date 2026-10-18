/**
 * Scene settings: the scene-level keys, edited beside the stage without going to the YAML.
 *
 * One group per key the parser reads at the top of a scene (`TOP_LEVEL_KEYS`) that is a
 * SETTING rather than content: `from`, `bg`, `transition`, `fx`, `music`, `locked`,
 * `camera`. Cast, props, beats and links have their own editors and are not here.
 *
 * The beat defaults — `autoAdvance`, `ease`, `bubble` — are NOT here: they live in the beat
 * tab at Step 0 (`BeatProps` with `scope: 'scene'`), on the same rows a beat overrides
 * them with. `sceneGlobalKeyWrite` / `sceneBubbleWrite` below turn those rows' writes
 * into scene keys.
 *
 * Split over sidebar panes (`pane`): `scene` is the scene's own settings, `camera` is the
 * shot — where it looks, how the backdrop moves, what weather is over it, `sounds` is what
 * is heard. A new pane is a new `SceneSettingsPane` and a `pane === …` block below.
 *
 * `sounds` is scope-aware like the beat tab: Step 0 edits the scene's `music:`, a beat on
 * screen (`soundBeat`) edits that beat's own `music:` and `sfx:` through `onWriteBeat`.
 *
 * Same grid as the beat props (`beat-props.tsx`): label, control, X. A row is highlighted
 * when the scene states the key, and the X removes it — back to whatever the layer under
 * the scene says. Every write REPLACES the whole key's value (`setSceneKey`), rebuilt from
 * the parsed scene, so a block-style value comes back as one flow line. That is the
 * documented cost of `setSceneKey`, confined to the key being edited.
 *
 * Number fields commit on blur and on Enter, never per keystroke: each write is a
 * CodeMirror edit, and "0", "0.", "0.6" in the undo stack is three reparses for one value.
 */

import {
	IconArrowsMove,
	IconCamera,
	IconCloudRain,
	IconDoorEnter,
	IconHelp,
	IconLock,
	IconMusic,
	IconPhoto,
	IconTemplate,
	IconVolume,
	IconX
} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {
	BG_MOTIONS,
	BUBBLE_KEYS,
	EASE_NAMES,
	MUSIC_DEFAULT_FADE,
	MUSIC_MAIN_TRACK,
	SCENE_LOCKS,
	SCENE_TRANSITION_ALIASES,
	SCENE_TRANSITION_KINDS
} from '@sliders/scene-types';
import type {
	AssetResolver,
	Beat,
	BubbleStyle,
	Camera,
	MusicEntry,
	MusicLoop,
	MusicSpec,
	Scene,
	SceneLock,
	StageBgFx,
	StageFx,
	StageSound
} from '@sliders/scene-types';
import {formatNumber, formatValue} from '@sliders/scene-edit';
import {CheckboxButton} from '../../../components/control/checkbox-button';
import {PreviewSelect} from '../../../components/control/preview-select';
import {TextSelect} from '../../../components/control/text-select';
import {NumberField} from './number-field';
import {useAssetLibrary} from '../../sliders-assets/asset-store-context';
import {FX_IDS} from '../use-scene-hints';
import {AssetPreview} from '../../sliders-assets/asset-preview';
import {cameraWrite} from './scene-gestures';
import {roundCoord} from './stage-geometry';
import type {SceneKeyWrite} from './use-scene-writer';
import './beat-props.css';
import './scene-settings-panel.css';

/** Which sidebar pane the panel is drawn in. Each pane renders its own groups. */
export type SceneSettingsPane = 'scene' | 'camera' | 'sounds';

export interface SceneSettingsPanelProps {
	/** Default `scene`. */
	pane?: SceneSettingsPane;
	/** `parse.result?.scene`. Absent renders nothing — no scene, nothing to set. */
	scene: Scene | undefined;
	/** False when there is no Doc to write to. Renders nothing. */
	editable: boolean;
	/**
	 * Kept for the parent's wiring. `AssetResolver` resolves names it is GIVEN and cannot
	 * list, so the pickers read `assetNames` instead.
	 */
	assets: AssetResolver;
	/**
	 * Names offered by the backdrop and music pickers: the story's view of the library,
	 * `kind: 'bg'` and `kind: 'sound'`. Absent = the pickers offer only what the scene
	 * already names. A name the scene states but the list lacks is always offered, so a
	 * picker never shows a value it cannot hold.
	 */
	assetNames?: {backgrounds: string[]; audio: string[]};
	/** A backdrop's thumbnail, by name, for the backdrop picker. Absent = names only. */
	bgPreview?: (name: string) => React.ReactNode;
	/**
	 * Passages `from:` may name: the story's scene passages, this one left out. A value the
	 * scene states but the list lacks is always offered.
	 */
	templates?: string[];
	/** The camera on screen (`camera` pane). Live during a pan, inherited under `from:`. */
	camera?: Camera;
	/** Why the camera may not be edited, when it may not (`locked: [bg]`). */
	cameraLockedReason?: string;
	/** Parent calls `commit(writes, EDIT_ORIGIN)`. */
	onWrite: (writes: SceneKeyWrite[]) => void;
	/**
	 * `sounds` pane: the beat on screen. Present = beat scope, its `music:` / `sfx:` are
	 * edited instead of the scene's. Absent = Step 0.
	 */
	soundBeat?: Beat;
	/** Beat scope writes: formatted YAML, `undefined` removes the beat's key. */
	onWriteBeat?: (key: 'music' | 'sfx', formatted: string | undefined) => void;
}

/** The empty option: the scene states nothing, so the layer underneath decides. */
const UNSET = '';

/** `bg: ~` / `music: ~`: nothing, stated out loud. */
const NONE = '~';

/**
 * Stands in for a value one dropdown cannot say: a per-kind `ease:` map, keyed music
 * tracks, a counted loop. Shown so the author is not told the scene says nothing; picking
 * it writes nothing, picking a real value replaces it — a choice made out loud.
 */
const CUSTOM = '\u0000custom';

/** What a picker offers: the list, with the current value added when the list lacks it. */
function withCurrent(names: readonly string[], current?: string): string[] {
	return current && !names.includes(current) ? [current, ...names] : [...names];
}

// ---------------------------------------------------------------------------
// Formatting — pure, so the YAML each control writes is checked without a DOM.
// ---------------------------------------------------------------------------

/** `bg:` back to YAML: the scalar unless a motion rides on it. `null` = `bg: ~`. */
export function formatBg(id: string | null, fx?: StageBgFx): string {
	if (id === null) {
		return NONE;
	}

	if (!fx) {
		return formatValue('bg', id);
	}

	return formatValue('bg', {id, fx: fx.id, speed: fx.speed});
}

export interface TransitionParts {
	kind?: string;
	dur?: number;
	ease?: string;
}

/**
 * Split the scene's `transition:` back into its three tokens.
 *
 * `Scene.transition` is the string as written (the map form is already flattened by
 * `formatSceneTransition`), and the parsed `SceneTransition` resolves the ease to CSS,
 * which a dropdown of words cannot show. So the words are read off the string. A kind
 * alias (`crossfade`) comes back canonical; anything with parentheses is a raw curve and
 * kept whole.
 */
export function splitTransition(text: string | undefined): TransitionParts {
	const parts: TransitionParts = {};

	if (!text) {
		return parts;
	}

	const tokens = text.match(/\S*\([^)]*\)\S*|\S+/g) ?? [];

	for (const token of tokens) {
		if ((SCENE_TRANSITION_KINDS as readonly string[]).includes(token)) {
			parts.kind = token;
		} else if (
			Object.prototype.hasOwnProperty.call(SCENE_TRANSITION_ALIASES, token)
		) {
			parts.kind = SCENE_TRANSITION_ALIASES[token];
		} else if (/^[-.\d]/.test(token)) {
			const match = /^(-?\d*\.?\d+)(ms|s)?$/.exec(token);

			if (match) {
				parts.dur =
					match[2] === 'ms' ? Number(match[1]) / 1000 : Number(match[1]);
			}
		} else {
			parts.ease = token;
		}
	}

	return parts;
}

/** The one-line form. `undefined` when nothing is left, i.e. remove the key. */
export function formatTransition(parts: TransitionParts): string | undefined {
	const text = [
		parts.kind,
		parts.dur === undefined ? undefined : `${formatNumber(parts.dur)}s`,
		parts.ease
	]
		.filter(Boolean)
		.join(' ');

	return text ? formatValue('transition', text) : undefined;
}

/** `fx: [rain@0.6, dark]`. Amount 1 is the default, so it is not written. */
export function formatFx(fx: StageFx[]): string | undefined {
	if (fx.length === 0) {
		return undefined;
	}

	return formatValue(
		'fx',
		fx.map(entry =>
			entry.amount === 1
				? entry.id
				: `${entry.id}@${formatNumber(entry.amount)}`
		)
	);
}

/** `sfx: door@0.4`. Volume 1 is the default, so it is not written. */
export function formatSfx(sound: StageSound): string {
	return formatValue(
		'sfx',
		sound.amount === 1 ? sound.id : `${sound.id}@${formatNumber(sound.amount)}`
	);
}

/** One `music:` entry as a flow map, or `id@volume` when that is all it says. */
function musicEntryValue(entry: MusicEntry, single: boolean): unknown {
	// A redefinition takes defaults for what it leaves out, so a default need not be
	// written. A PATCH (no id) changes only what it names: `{volume: 1}` there is a ramp
	// back up, not a default, and dropping it would silently change the scene.
	const patch = entry.id === undefined;
	const amount = !patch && entry.amount === 1 ? undefined : entry.amount;
	// The single form loops unless told otherwise, a keyed track plays once.
	const loop =
		!patch && entry.loop === (single ? true : false) ? undefined : entry.loop;
	const rest = {
		fade: entry.fade,
		loop,
		restart: entry.restart || undefined,
		start: entry.start || undefined
	};

	if (!patch && Object.values(rest).every(value => value === undefined)) {
		return amount === undefined
			? entry.id
			: `${entry.id}@${formatNumber(amount)}`;
	}

	return {
		id: entry.id,
		volume: amount,
		loop: rest.loop,
		fade: rest.fade,
		start: rest.start,
		restart: rest.restart
	};
}

/**
 * Whether a spec can be written as the single form.
 *
 * Only a lone `main` track that names a sound and states its loop: the parser fills
 * `loop: true` into every single form, so a `main` whose loop is undefined was written
 * KEYED, where the default is play-once. Collapsing that one would make it loop.
 */
export function isSingleMusic(spec: MusicSpec): boolean {
	const names = Object.keys(spec.tracks);
	const main = spec.tracks[MUSIC_MAIN_TRACK];

	return (
		names.length === 1 &&
		names[0] === MUSIC_MAIN_TRACK &&
		!!main &&
		main.id !== undefined &&
		main.loop !== undefined
	);
}

/** `music:` back to YAML. `null` = `music: ~`. `undefined` = nothing left, remove the key. */
export function formatMusic(spec: MusicSpec | null): string | undefined {
	if (spec === null) {
		return NONE;
	}

	const stop = spec.stopOthers;

	if (isSingleMusic(spec)) {
		const value = musicEntryValue(spec.tracks[MUSIC_MAIN_TRACK]!, true);

		if (!stop) {
			return formatValue('music', value);
		}

		const map =
			typeof value === 'string'
				? {id: spec.tracks[MUSIC_MAIN_TRACK]!.id, volume: amountOf(value)}
				: (value as Record<string, unknown>);

		return formatValue('music', {...map, 'stop-other-tracks': stop});
	}

	const map: Record<string, unknown> = {};

	for (const [name, entry] of Object.entries(spec.tracks)) {
		map[name] = entry === null ? null : musicEntryValue(entry, false);
	}

	if (stop) {
		map['stop-other-tracks'] = stop;
	}

	return Object.keys(map).length === 0 ? undefined : formatValue('music', map);
}

/** The volume back out of `rain@0.4`, for the one path that widens a scalar to a map. */
function amountOf(token: string): number | undefined {
	const at = token.lastIndexOf('@');

	return at === -1 ? undefined : Number(token.slice(at + 1));
}

/** Pairs as the author types them, `[x, y]` — never the parser's `{x, y}`. */
function bubbleValue(style: BubbleStyle): Record<string, unknown> {
	const out: Record<string, unknown> = {};

	for (const key of BUBBLE_KEYS) {
		const value = style[key];

		if (value === undefined) {
			continue;
		}

		out[key] =
			typeof value === 'object' ? [value.x, value.y] : (value as unknown);
	}

	return out;
}

/** `bubble:` back to YAML, in `BUBBLE_KEYS` order. `undefined` = nothing left. */
export function formatBubble(style: BubbleStyle): string | undefined {
	const value = bubbleValue(style);

	return Object.keys(value).length === 0
		? undefined
		: formatValue('bubble', value);
}

/**
 * A Step 0 beat-row write (`BeatProps` in the `scene` scope) as the scene key it means:
 * `dur` is `autoAdvance:`, `ease` is `ease:`. `null` removes. Anything else: `undefined`.
 */
export function sceneGlobalKeyWrite(
	key: string,
	value: unknown
): SceneKeyWrite | undefined {
	const gone = value === null || value === undefined || value === '';

	switch (key) {
		case 'dur':
			return {
				formatted: gone ? undefined : formatNumber(value as number),
				sceneKey: 'autoAdvance'
			};
		case 'ease':
			return {
				formatted: gone ? undefined : formatValue('ease', value),
				sceneKey: 'ease'
			};
	}

	return undefined;
}

/** One key of the scene's `bubble:`, the rest kept. `null` removes the key. */
export function sceneBubbleWrite(
	bubble: BubbleStyle | undefined,
	key: keyof BubbleStyle,
	value: unknown
): SceneKeyWrite {
	return {
		formatted: formatBubble({
			...bubble,
			[key]: value === null || value === '' ? undefined : value
		}),
		sceneKey: 'bubble'
	};
}

/** `locked:` — `true`, or the list of what is pinned. */
export function formatLocked(locked: true | SceneLock[]): string {
	return locked === true ? 'true' : formatValue('locked', locked);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

interface SettingRowProps {
	children: React.ReactNode;
	label: React.ReactNode;
	/** What the row falls back to with nothing stated. Absent hides the line. */
	fallback?: React.ReactNode;
	/** The scene states this. Highlights the row and enables the X. */
	stated?: boolean;
	/** Removes the key (or the part of it this row owns). Absent: no X. */
	onReset?: () => void;
	resetLabel: string;
	testId?: string;
}

/**
 * One line of the grid. The beat props' row, on the beat props' classes, so the two
 * panels line up and restyle together.
 */
const SettingRow: React.FC<SettingRowProps> = ({
	children,
	fallback,
	label,
	onReset,
	resetLabel,
	stated,
	testId
}) => (
	<div
		className={classNames('beat-prop-row', {overridden: stated})}
		data-overridden={stated ? 'true' : undefined}
		data-testid={testId}
	>
		<span aria-hidden className="beat-prop-label">
			{label}
		</span>
		<div className="beat-prop-control">{children}</div>
		{onReset ? (
			<button
				aria-label={resetLabel}
				className="beat-prop-reset"
				disabled={!stated}
				onClick={onReset}
				title={resetLabel}
				type="button"
			>
				<IconX />
			</button>
		) : (
			<span />
		)}
		{fallback !== undefined && (
			<span className="beat-prop-default">{fallback}</span>
		)}
	</div>
);

/** A group's title line: icon, words, and an optional `?` that explains on hover. */
const Heading: React.FC<{
	help?: string;
	helpTestId?: string;
	icon: React.ReactNode;
}> = ({children, help, helpTestId, icon}) => (
	<h4 className="scene-preview-beat-props-heading">
		{icon}
		{children}
		{help && (
			<span
				aria-label={help}
				className="beat-prop-help"
				data-testid={helpTestId}
				role="img"
				tabIndex={0}
				title={help}
			>
				<IconHelp />
			</span>
		)}
	</h4>
);

/** A loop as one dropdown value. Counts and sections are a readout. */
function loopChoice(loop: MusicLoop | undefined, single: boolean): string {
	if (loop === undefined || loop === single) {
		return UNSET;
	}

	return typeof loop === 'boolean' ? String(loop) : CUSTOM;
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export const SceneSettingsPanel: React.FC<SceneSettingsPanelProps> = ({
	assetNames,
	bgPreview,
	camera,
	cameraLockedReason,
	editable,
	onWrite,
	onWriteBeat,
	pane = 'scene',
	scene,
	soundBeat,
	templates
}) => {
	const {t} = useTranslation();

	if (!editable || !scene) {
		return null;
	}

	const key = (name: string) =>
		`dialogs.passageEdit.scenePreview.settings.${name}`;
	const label = (name: string) => t(key(name));
	const resetLabel = (name: string) => t(key('reset'), {name: label(name)});
	const fallback = (value: React.ReactNode) => (
		<>
			{label('defaultIs')} {value}
		</>
	);
	const write = (sceneKey: SceneKeyWrite['sceneKey'], formatted?: string) =>
		onWrite([{formatted, sceneKey}]);
	const unsetOption = {label: label('unset'), value: UNSET};
	const customOption = (name: string) => ({label: label(name), value: CUSTOM});

	// --- bg -----------------------------------------------------------------

	const bgStated = scene.bg !== undefined;
	const bgId = scene.bg === null ? NONE : scene.bg ?? UNSET;
	const bgNames = withCurrent(
		assetNames?.backgrounds ?? [],
		typeof scene.bg === 'string' ? scene.bg : undefined
	);
	const bgFx = scene.bgFx;
	// A motion needs art to move: `bg: ~` and an unstated bg have none.
	const hasArt = typeof scene.bg === 'string';
	const setBgFx = (fx: StageBgFx | undefined) => {
		if (hasArt) {
			write('bg', formatBg(scene.bg as string, fx));
		}
	};

	// --- transition ---------------------------------------------------------

	const transition = splitTransition(scene.transition);
	const setTransition = (patch: Partial<TransitionParts>) =>
		write('transition', formatTransition({...transition, ...patch}));
	const transitionEases = withCurrent(EASE_NAMES, transition.ease);

	// --- fx -----------------------------------------------------------------

	const fx = scene.fx ?? [];
	const setFx = (next: StageFx[]) => write('fx', formatFx(next));
	const unusedFx = FX_IDS.filter(id => !fx.some(entry => entry.id === id));

	// --- music --------------------------------------------------------------

	// Scope: Step 0 is the scene's `music:`, a beat on screen its own.
	const music = soundBeat ? soundBeat.music : scene.music;
	const writeMusic = (formatted?: string) =>
		soundBeat ? onWriteBeat?.('music', formatted) : write('music', formatted);
	/** Only `say`, `set` and `box` have a body map to hold a sound key. */
	const soundBody =
		!soundBeat ||
		soundBeat.kind === 'say' ||
		soundBeat.kind === 'set' ||
		soundBeat.kind === 'box';
	const sfx = soundBeat?.sfx;
	const writeSfx = (id: string | undefined, amount: number | undefined) =>
		onWriteBeat?.('sfx', id ? formatSfx({amount: amount ?? 1, id}) : undefined);
	const single = !!music && isSingleMusic(music);
	const main = single ? music!.tracks[MUSIC_MAIN_TRACK]! : undefined;
	const musicChoice =
		music === undefined
			? UNSET
			: music === null
			? NONE
			: single
			? main!.id!
			: CUSTOM;
	const audioNames = withCurrent(assetNames?.audio ?? [], main?.id);
	const setTrack = (name: string, entry: MusicEntry | null) => {
		if (music) {
			writeMusic(
				formatMusic({...music, tracks: {...music.tracks, [name]: entry}})
			);
		}
	};
	const dropTrack = (name: string) => {
		if (!music) {
			return;
		}

		const tracks = {...music.tracks};

		delete tracks[name];
		writeMusic(formatMusic({...music, tracks}));
	};

	/** The rows of one track. `single` is the one-bed form, where loop defaults on. */
	const trackRows = (name: string, entry: MusicEntry, isSingle: boolean) => {
		const patch = (next: Partial<MusicEntry>) => {
			const merged = {...entry, ...next};

			// The single form has to keep a stated loop, or it would be written keyed.
			if (isSingle && merged.loop === undefined) {
				merged.loop = true;
			}

			setTrack(name, merged);
		};
		const prefix = `scene-settings-music-${name}`;
		const loop = loopChoice(entry.loop, isSingle);

		return (
			<>
				{!isSingle && (
					<SettingRow
						fallback={entry.id === undefined ? label('musicPatch') : undefined}
						label={label('musicSound')}
						resetLabel={resetLabel('musicSound')}
						stated={entry.id !== undefined}
						testId={`${prefix}-id`}
					>
						<TextSelect
							onChange={event => patch({id: event.target.value || undefined})}
							options={[
								{label: label('musicPatchOption'), value: UNSET},
								...withCurrent(assetNames?.audio ?? [], entry.id).map(id => ({
									label: id,
									value: id
								}))
							]}
							value={entry.id ?? UNSET}
						>
							{label('musicSound')}
						</TextSelect>
					</SettingRow>
				)}
				<SettingRow
					fallback={fallback('1')}
					label={label('volume')}
					onReset={() => patch({amount: undefined})}
					resetLabel={resetLabel('volume')}
					stated={entry.amount !== undefined && entry.amount !== 1}
					testId={`${prefix}-volume`}
				>
					<NumberField
						label={label('volume')}
						max={1}
						min={0}
						onCommit={amount => patch({amount})}
						placeholder="1"
						step={0.1}
						value={entry.amount}
					/>
				</SettingRow>
				<SettingRow
					fallback={fallback(label(isSingle ? 'loopOn' : 'loopOff'))}
					label={label('loop')}
					onReset={() => patch({loop: undefined})}
					resetLabel={resetLabel('loop')}
					stated={loop !== UNSET}
					testId={`${prefix}-loop`}
				>
					<TextSelect
						onChange={event => {
							const value = event.target.value;

							if (value === CUSTOM) {
								return;
							}

							patch({loop: value === UNSET ? undefined : value === 'true'});
						}}
						options={[
							unsetOption,
							...(loop === CUSTOM ? [customOption('loopCustom')] : []),
							{label: label('loopOn'), value: 'true'},
							{label: label('loopOff'), value: 'false'}
						]}
						value={loop}
					>
						{label('loop')}
					</TextSelect>
				</SettingRow>
				<SettingRow
					fallback={fallback(`${MUSIC_DEFAULT_FADE}s`)}
					label={label('fade')}
					onReset={() => patch({fade: undefined})}
					resetLabel={resetLabel('fade')}
					stated={entry.fade !== undefined}
					testId={`${prefix}-fade`}
				>
					<NumberField
						label={label('fade')}
						min={0}
						onCommit={fade => patch({fade})}
						placeholder={String(MUSIC_DEFAULT_FADE)}
						step={0.5}
						unit="s"
						value={entry.fade}
					/>
				</SettingRow>
				<SettingRow
					fallback={fallback('0s')}
					label={label('start')}
					onReset={() => patch({start: undefined})}
					resetLabel={resetLabel('start')}
					stated={!!entry.start}
					testId={`${prefix}-start`}
				>
					<NumberField
						label={label('start')}
						min={0}
						onCommit={start => patch({start})}
						placeholder="0"
						unit="s"
						value={entry.start}
					/>
				</SettingRow>
				<SettingRow
					label={label('restart')}
					onReset={() => patch({restart: undefined})}
					resetLabel={resetLabel('restart')}
					stated={!!entry.restart}
					testId={`${prefix}-restart`}
				>
					<CheckboxButton
						label={label('restart')}
						onChange={restart => patch({restart: restart || undefined})}
						tooltipLabel={label('restartDetail')}
						iconOnly
						value={!!entry.restart}
					/>
				</SettingRow>
			</>
		);
	};

	const stop = music?.stopOthers;
	const stopChoice = stop === 'all' ? 'all' : stop ? CUSTOM : UNSET;

	// --- locked -------------------------------------------------------------

	const locked =
		scene.locked === true
			? 'true'
			: scene.locked
			? [...scene.locked].sort().join(',')
			: UNSET;
	const lockOptions = [
		unsetOption,
		{label: label('lockAll'), value: 'true'},
		...SCENE_LOCKS.map(name => ({label: label(`lock_${name}`), value: name})),
		{label: label('lockBoth'), value: [...SCENE_LOCKS].sort().join(',')}
	];

	// --- from ---------------------------------------------------------------

	const templateNames = withCurrent(templates ?? [], scene.from);

	// --- camera -------------------------------------------------------------

	// Rounded as the gesture writes it: a live pan paints float noise (0.10000000149).
	const cameraNow: Camera = {
		at: {x: roundCoord(camera?.at.x ?? 0), y: roundCoord(camera?.at.y ?? 0)},
		zoom: roundCoord(camera?.zoom ?? 1)
	};
	// Off rest, not merely written: the gesture never writes a part at rest.
	const cameraStated = {
		x: !!scene.camera?.at && cameraNow.at.x !== 0,
		y: !!scene.camera?.at && cameraNow.at.y !== 0,
		zoom: scene.camera?.zoom !== undefined && cameraNow.zoom !== 1
	};
	// The whole camera is written, as the pan gesture writes it: one key, at rest = gone.
	const setCamera = (axis: 'x' | 'y' | 'zoom', value: number | undefined) =>
		onWrite([
			cameraWrite(
				axis === 'zoom'
					? {...cameraNow, zoom: value ?? 1}
					: {...cameraNow, at: {...cameraNow.at, [axis]: value ?? 0}}
			)
		]);

	return (
		<div
			className="scene-settings-panel"
			data-pane={pane}
			data-testid="scene-settings-panel"
		>
			{pane === 'scene' && (
				<>
					<div
						className="scene-preview-beat-props-group"
						data-testid="scene-settings-from-group"
					>
						<Heading
							help={label('fromHelp')}
							helpTestId="scene-settings-from-help"
							icon={<IconTemplate />}
						>
							{label('fromHeading')}
						</Heading>
						<SettingRow
							fallback={fallback(label('fromNone'))}
							label={label('from')}
							onReset={() => write('from')}
							resetLabel={resetLabel('from')}
							stated={scene.from !== undefined}
							testId="scene-settings-from"
						>
							<PreviewSelect
								onChange={value =>
									write('from', value ? formatValue('from', value) : undefined)
								}
								options={[
									unsetOption,
									...templateNames.map(name => ({label: name, value: name}))
								]}
								searchable
								value={scene.from ?? UNSET}
							>
								{label('from')}
							</PreviewSelect>
						</SettingRow>
					</div>

					<div className="scene-preview-beat-props-group">
						<Heading icon={<IconPhoto />}>{label('backdrop')}</Heading>
						<SettingRow
							fallback={fallback(label('bgInherit'))}
							label={label('bg')}
							onReset={() => write('bg')}
							resetLabel={resetLabel('bg')}
							stated={bgStated}
							testId="scene-settings-bg"
						>
							<PreviewSelect
								onChange={value => {
									if (value === UNSET) {
										write('bg');
									} else if (value === NONE) {
										write('bg', formatBg(null));
									} else {
										// The motion goes with the art it moved: keep it.
										write('bg', formatBg(value, bgFx));
									}
								}}
								options={[
									unsetOption,
									{label: label('bgNone'), value: NONE},
									...bgNames.map(name => ({
										label: name,
										preview: bgPreview?.(name),
										value: name
									}))
								]}
								searchable
								value={bgId}
							>
								{label('bg')}
							</PreviewSelect>
						</SettingRow>
					</div>

					<div className="scene-preview-beat-props-group">
						<Heading icon={<IconDoorEnter />}>{label('arrival')}</Heading>
						<SettingRow
							fallback={fallback(label('transitionInherit'))}
							label={label('transition')}
							onReset={() => setTransition({kind: undefined})}
							resetLabel={resetLabel('transition')}
							stated={transition.kind !== undefined}
							testId="scene-settings-transition"
						>
							<TextSelect
								onChange={event =>
									setTransition({kind: event.target.value || undefined})
								}
								options={[
									unsetOption,
									...SCENE_TRANSITION_KINDS.map(kind => ({
										label: kind,
										value: kind
									}))
								]}
								value={transition.kind ?? UNSET}
							>
								{label('transition')}
							</TextSelect>
						</SettingRow>
						<SettingRow
							fallback={fallback(label('transitionDurInherit'))}
							label={label('transitionDur')}
							onReset={() => setTransition({dur: undefined})}
							resetLabel={resetLabel('transitionDur')}
							stated={transition.dur !== undefined}
							testId="scene-settings-transition-dur"
						>
							<NumberField
								label={label('transitionDur')}
								max={2}
								min={0}
								onCommit={dur => setTransition({dur})}
								placeholder="0.3"
								step={0.1}
								unit="s"
								value={transition.dur}
							/>
						</SettingRow>
						<SettingRow
							fallback={fallback(label('transitionEaseInherit'))}
							label={label('transitionEase')}
							onReset={() => setTransition({ease: undefined})}
							resetLabel={resetLabel('transitionEase')}
							stated={transition.ease !== undefined}
							testId="scene-settings-transition-ease"
						>
							<TextSelect
								onChange={event =>
									setTransition({ease: event.target.value || undefined})
								}
								options={[
									unsetOption,
									...transitionEases.map(name => ({label: name, value: name}))
								]}
								value={transition.ease ?? UNSET}
							>
								{label('transitionEase')}
							</TextSelect>
						</SettingRow>
					</div>

					<div className="scene-preview-beat-props-group">
						<Heading icon={<IconLock />}>{label('editor')}</Heading>
						<SettingRow
							fallback={fallback(label('lockNone'))}
							label={label('locked')}
							onReset={() => write('locked')}
							resetLabel={resetLabel('locked')}
							stated={scene.locked !== undefined}
							testId="scene-settings-locked"
						>
							<TextSelect
								onChange={event => {
									const value = event.target.value;

									write(
										'locked',
										value === UNSET
											? undefined
											: formatLocked(
													value === 'true'
														? true
														: (value.split(',') as SceneLock[])
											  )
									);
								}}
								options={lockOptions}
								value={locked}
							>
								{label('locked')}
							</TextSelect>
						</SettingRow>
					</div>
				</>
			)}
			{pane === 'sounds' && (
				<>
					{soundBody ? (
						<>
							<div
								className="scene-preview-beat-props-group"
								data-testid="scene-settings-music-group"
							>
								<Heading icon={<IconMusic />}>{label('music')}</Heading>
								<SettingRow
									fallback={fallback(
										label(soundBeat ? 'musicKeep' : 'musicInherit')
									)}
									label={label('musicSound')}
									onReset={() => writeMusic()}
									resetLabel={resetLabel('music')}
									stated={music !== undefined}
									testId="scene-settings-music"
								>
									<TextSelect
										onChange={event => {
											const value = event.target.value;

											if (value === CUSTOM) {
												return;
											}

											if (value === UNSET) {
												writeMusic();
											} else if (value === NONE) {
												writeMusic(formatMusic(null));
											} else if (main) {
												// Same bed, another sound: its volume, loop and fade stay.
												writeMusic(
													formatMusic({
														...music!,
														tracks: {[MUSIC_MAIN_TRACK]: {...main, id: value}}
													})
												);
											} else {
												writeMusic(formatValue('music', value));
											}
										}}
										options={[
											unsetOption,
											{label: label('musicSilence'), value: NONE},
											...(musicChoice === CUSTOM
												? [customOption('musicTracks')]
												: []),
											...audioNames.map(name => ({label: name, value: name}))
										]}
										value={musicChoice}
									>
										{label('musicSound')}
									</TextSelect>
								</SettingRow>
								{main && trackRows(MUSIC_MAIN_TRACK, main, true)}
								{music &&
									!single &&
									Object.entries(music.tracks).map(([name, entry]) => (
										<div
											className="scene-settings-track"
											data-testid={`scene-settings-track-${name}`}
											key={name}
										>
											<SettingRow
												label={<strong>{name}</strong>}
												onReset={() => dropTrack(name)}
												resetLabel={t(key('reset'), {name})}
												stated
												testId={`scene-settings-track-${name}-name`}
											>
												{entry === null && (
													<span className="beat-prop-unit">
														{label('musicStopped')}
													</span>
												)}
											</SettingRow>
											{entry && trackRows(name, entry, false)}
										</div>
									))}
								{music && (
									<SettingRow
										fallback={fallback(label('stopOthersNone'))}
										label={label('stopOthers')}
										onReset={() =>
											writeMusic(formatMusic({...music, stopOthers: undefined}))
										}
										resetLabel={resetLabel('stopOthers')}
										stated={stop !== undefined}
										testId="scene-settings-stop-others"
									>
										<TextSelect
											onChange={event => {
												const value = event.target.value;

												if (value === CUSTOM) {
													return;
												}

												writeMusic(
													formatMusic({
														...music,
														stopOthers: value === 'all' ? 'all' : undefined
													})
												);
											}}
											options={[
												unsetOption,
												...(stopChoice === CUSTOM
													? [
															{
																label: (stop as string[]).join(', '),
																value: CUSTOM
															}
													  ]
													: []),
												{label: label('stopOthersAll'), value: 'all'}
											]}
											value={stopChoice}
										>
											{label('stopOthers')}
										</TextSelect>
									</SettingRow>
								)}
							</div>

							{soundBeat && (
								<div
									className="scene-preview-beat-props-group"
									data-testid="scene-settings-sfx-group"
								>
									<Heading icon={<IconVolume />}>{label('sfx')}</Heading>
									<SettingRow
										fallback={fallback(label('sfxNone'))}
										label={label('musicSound')}
										onReset={() => writeSfx(undefined, undefined)}
										resetLabel={resetLabel('sfx')}
										stated={!!sfx}
										testId="scene-settings-sfx"
									>
										<TextSelect
											onChange={event =>
												writeSfx(event.target.value || undefined, sfx?.amount)
											}
											options={[
												unsetOption,
												...withCurrent(assetNames?.audio ?? [], sfx?.id).map(
													id => ({label: id, value: id})
												)
											]}
											value={sfx?.id ?? UNSET}
										>
											{label('musicSound')}
										</TextSelect>
									</SettingRow>
									<SettingRow
										fallback={fallback('1')}
										label={label('volume')}
										onReset={() => sfx && writeSfx(sfx.id, undefined)}
										resetLabel={resetLabel('volume')}
										stated={!!sfx && sfx.amount !== 1}
										testId="scene-settings-sfx-volume"
									>
										<NumberField
											disabled={!sfx}
											label={label('volume')}
											max={1}
											min={0}
											onCommit={amount => sfx && writeSfx(sfx.id, amount)}
											placeholder="1"
											step={0.1}
											value={sfx?.amount}
										/>
									</SettingRow>
								</div>
							)}
						</>
					) : (
						<p
							className="scene-sidebar-empty"
							data-testid="scene-settings-sound-note"
						>
							{label(
								soundBeat?.kind === 'sfx' || soundBeat?.kind === 'music'
									? 'soundCommand'
									: 'soundNoBody'
							)}
						</p>
					)}
				</>
			)}
			{pane === 'camera' && (
				<>
					<div
						className="scene-preview-beat-props-group"
						data-testid="scene-settings-camera-group"
					>
						<Heading icon={<IconCamera />}>{label('camera')}</Heading>
						<SettingRow
							fallback={cameraLockedReason ?? fallback('0')}
							label={label('cameraX')}
							onReset={
								cameraLockedReason ? undefined : () => setCamera('x', undefined)
							}
							resetLabel={resetLabel('cameraX')}
							stated={cameraStated.x}
							testId="scene-settings-camera-x"
						>
							<NumberField
								disabled={!!cameraLockedReason}
								label={label('cameraX')}
								onCommit={value => setCamera('x', value)}
								placeholder="0"
								step={0.01}
								value={cameraNow.at.x}
							/>
						</SettingRow>
						<SettingRow
							fallback={fallback('0')}
							label={label('cameraY')}
							onReset={
								cameraLockedReason ? undefined : () => setCamera('y', undefined)
							}
							resetLabel={resetLabel('cameraY')}
							stated={cameraStated.y}
							testId="scene-settings-camera-y"
						>
							<NumberField
								disabled={!!cameraLockedReason}
								label={label('cameraY')}
								onCommit={value => setCamera('y', value)}
								placeholder="0"
								step={0.01}
								value={cameraNow.at.y}
							/>
						</SettingRow>
						<SettingRow
							fallback={fallback('1')}
							label={label('cameraZoom')}
							onReset={
								cameraLockedReason
									? undefined
									: () => setCamera('zoom', undefined)
							}
							resetLabel={resetLabel('cameraZoom')}
							stated={cameraStated.zoom}
							testId="scene-settings-camera-zoom"
						>
							<NumberField
								disabled={!!cameraLockedReason}
								label={label('cameraZoom')}
								min={0.1}
								onCommit={value => setCamera('zoom', value)}
								placeholder="1"
								step={0.1}
								value={cameraNow.zoom}
							/>
						</SettingRow>
					</div>

					<div
						className="scene-preview-beat-props-group"
						data-testid="scene-settings-motion-group"
					>
						<Heading icon={<IconArrowsMove />}>{label('motion')}</Heading>
						<SettingRow
							fallback={fallback(label('bgStill'))}
							label={label('bgFx')}
							onReset={() => setBgFx(undefined)}
							resetLabel={resetLabel('bgFx')}
							stated={!!bgFx}
							testId="scene-settings-bg-fx"
						>
							<TextSelect
								disabled={!hasArt}
								onChange={event =>
									setBgFx(
										event.target.value
											? {id: event.target.value, speed: bgFx?.speed}
											: undefined
									)
								}
								options={[
									{label: label('bgStill'), value: UNSET},
									...withCurrent(BG_MOTIONS, bgFx?.id).map(id => ({
										label: id,
										value: id
									}))
								]}
								value={bgFx?.id ?? UNSET}
							>
								{label('bgFx')}
							</TextSelect>
						</SettingRow>
						<SettingRow
							fallback={fallback(label('bgSpeedPreset'))}
							label={label('bgSpeed')}
							onReset={() => setBgFx(bgFx && {id: bgFx.id})}
							resetLabel={resetLabel('bgSpeed')}
							stated={bgFx?.speed !== undefined}
							testId="scene-settings-bg-speed"
						>
							<NumberField
								disabled={!bgFx}
								label={label('bgSpeed')}
								min={0.1}
								onCommit={speed => setBgFx(bgFx && {id: bgFx.id, speed})}
								unit="s"
								value={bgFx?.speed}
							/>
						</SettingRow>
					</div>

					<div
						className="scene-preview-beat-props-group"
						data-testid="scene-settings-fx-group"
					>
						<Heading icon={<IconCloudRain />}>{label('fx')}</Heading>
						{fx.map((entry, index) => (
							<SettingRow
								key={`${entry.id}-${index}`}
								label={entry.id}
								onReset={() => setFx(fx.filter((_, at) => at !== index))}
								resetLabel={t(key('reset'), {name: entry.id})}
								stated
								testId={`scene-settings-fx-${entry.id}`}
							>
								<NumberField
									label={label('fxAmount')}
									max={1}
									min={0}
									onCommit={amount =>
										setFx(
											fx.map((one, at) =>
												at === index ? {...one, amount: amount ?? 1} : one
											)
										)
									}
									placeholder="1"
									step={0.1}
									value={entry.amount}
								/>
							</SettingRow>
						))}
						{unusedFx.length > 0 && (
							<SettingRow
								label={label('fxAdd')}
								resetLabel={label('fxAdd')}
								testId="scene-settings-fx-add"
							>
								<TextSelect
									onChange={event => {
										if (event.target.value) {
											setFx([...fx, {amount: 1, id: event.target.value}]);
										}
									}}
									options={[
										{label: label('fxAddPrompt'), value: UNSET},
										...unusedFx.map(id => ({label: id, value: id}))
									]}
									value={UNSET}
								>
									{label('fxAdd')}
								</TextSelect>
							</SettingRow>
						)}
					</div>
				</>
			)}
		</div>
	);
};

/**
 * The panel as the sidebar's settings tab mounts it: the asset name lists come from the
 * library here, so only an open settings tab pays for listing the library.
 */
export const SceneSettingsTab: React.FC<
	Omit<SceneSettingsPanelProps, 'assetNames' | 'bgPreview'>
> = props => {
	const {all} = useAssetLibrary();
	const assetNames = React.useMemo(() => {
		const named = (kind: string) =>
			all
				.filter(asset => asset.kind === kind)
				.map(asset => asset.name)
				.sort((a, b) => a.localeCompare(b));

		return {audio: named('sound'), backgrounds: named('bg')};
	}, [all]);
	const bgPreview = React.useMemo(() => {
		const ids = new Map(
			all
				.filter(asset => asset.kind === 'bg')
				.map(asset => [asset.name, asset.id] as const)
		);

		// Elements only: an AssetPreview fetches when the open list draws it.
		return (name: string) =>
			ids.has(name) ? (
				<AssetPreview
					alt=""
					assetId={ids.get(name)}
					className="scene-settings-bg-thumb"
				/>
			) : undefined;
	}, [all]);

	return (
		<SceneSettingsPanel
			{...props}
			assetNames={assetNames}
			bgPreview={bgPreview}
		/>
	);
};
