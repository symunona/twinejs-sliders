/**
 * Scene settings: the scene-level keys, edited beside the stage without going to the YAML.
 *
 * One group per key the parser reads at the top of a scene (`TOP_LEVEL_KEYS`) that is a
 * SETTING rather than content: `bg`, `transition`, `ease`, `autoAdvance`, `fx`, `music`,
 * `bubble`, `locked`. Cast, props, beats, links, `from:` and `camera:` have their own
 * editors (or gestures) and are not here.
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

import {IconX} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {
	BG_MOTIONS,
	BUBBLE_ANCHORS,
	BUBBLE_KEYS,
	BUBBLE_PLACES,
	BUBBLE_SIZINGS,
	EASE_NAMES,
	MUSIC_DEFAULT_FADE,
	MUSIC_MAIN_TRACK,
	SCENE_LOCKS,
	SCENE_TRANSITION_ALIASES,
	SCENE_TRANSITION_KINDS,
	bubbleFontStack
} from '@sliders/scene-types';
import type {
	AssetResolver,
	BubbleStyle,
	MusicEntry,
	MusicLoop,
	MusicSpec,
	Scene,
	SceneLock,
	StageBgFx,
	StageFx
} from '@sliders/scene-types';
import {formatNumber, formatValue} from '@sliders/scene-edit';
import {CheckboxButton} from '../../../components/control/checkbox-button';
import {PreviewSelect} from '../../../components/control/preview-select';
import {TextInput} from '../../../components/control/text-input';
import {TextSelect} from '../../../components/control/text-select';
import {BubbleColorControl} from '../../bubble-style/bubble-color-control';
import {
	BubbleFontSwatch,
	bubbleFontOptions,
	bubbleStyleOptions
} from '../../bubble-style/bubble-previews';
import {useAssetLibrary} from '../../sliders-assets/asset-store-context';
import {FX_IDS} from '../use-scene-hints';
import type {SceneKeyWrite} from './use-scene-writer';
import './beat-props.css';
import './scene-settings-panel.css';

export interface SceneSettingsPanelProps {
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
	/** Parent calls `commit(writes, EDIT_ORIGIN)`. */
	onWrite: (writes: SceneKeyWrite[]) => void;
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

interface NumberFieldProps {
	label: string;
	value: number | undefined;
	/** Called with the new number, or `undefined` when the box was emptied. */
	onCommit: (value: number | undefined) => void;
	disabled?: boolean;
	min?: number;
	max?: number;
	step?: number;
	placeholder?: string;
	unit?: string;
}

/**
 * A number box that writes on blur and Enter. Escape puts back what the text says.
 *
 * Refuses rather than writes what the parser would only reject back: not a number, or
 * outside `min`/`max`. An emptied box is a removal, not a zero.
 */
const NumberField: React.FC<NumberFieldProps> = ({
	disabled,
	label,
	max,
	min,
	onCommit,
	placeholder,
	step,
	unit,
	value
}) => {
	const [draft, setDraft] = React.useState<string>();
	const shown = draft ?? (value === undefined ? '' : String(value));

	// A reparse that changed the value under the box wins over a stale draft.
	React.useEffect(() => setDraft(undefined), [value]);

	function commit() {
		setDraft(undefined);

		const trimmed = shown.trim();

		if (trimmed === '') {
			if (value !== undefined) {
				onCommit(undefined);
			}

			return;
		}

		const next = Number(trimmed);

		if (
			!Number.isFinite(next) ||
			next === value ||
			(min !== undefined && next < min) ||
			(max !== undefined && next > max)
		) {
			return;
		}

		onCommit(next);
	}

	return (
		<>
			<span className="scene-settings-number">
				<TextInput
					disabled={disabled}
					max={max}
					min={min}
					onBlur={commit}
					onChange={event => setDraft(event.target.value)}
					onKeyDown={event => {
						if (event.key === 'Enter') {
							commit();
						}

						if (event.key === 'Escape') {
							setDraft(undefined);
						}
					}}
					placeholder={placeholder}
					step={step}
					type="number"
					value={shown}
				>
					{label}
				</TextInput>
			</span>
			{unit && <span className="beat-prop-unit">{unit}</span>}
		</>
	);
};

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
	editable,
	onWrite,
	scene
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

	// --- ease ---------------------------------------------------------------

	const ease =
		typeof scene.ease === 'string' ? scene.ease : scene.ease ? CUSTOM : UNSET;

	// --- fx -----------------------------------------------------------------

	const fx = scene.fx ?? [];
	const setFx = (next: StageFx[]) => write('fx', formatFx(next));
	const unusedFx = FX_IDS.filter(id => !fx.some(entry => entry.id === id));

	// --- music --------------------------------------------------------------

	const music = scene.music;
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
			write(
				'music',
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
		write('music', formatMusic({...music, tracks}));
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

	// --- bubble -------------------------------------------------------------

	const bubble = scene.bubble ?? {};
	const setBubble = (name: keyof BubbleStyle, value: unknown) =>
		write(
			'bubble',
			formatBubble({
				...bubble,
				[name]: value === null || value === '' ? undefined : value
			})
		);
	const bubbleRow = (name: keyof BubbleStyle) => ({
		fallback: fallback(label('storyDefault')),
		label: label(`bubble_${name}`),
		onReset: () => setBubble(name, null),
		resetLabel: resetLabel(`bubble_${name}`),
		stated: bubble[name] !== undefined,
		testId: `scene-settings-bubble-${name}`
	});

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

	return (
		<div className="scene-settings-panel" data-testid="scene-settings-panel">
			<div className="scene-preview-beat-props-group">
				<h4 className="scene-preview-beat-props-heading">
					{label('backdrop')}
				</h4>
				<SettingRow
					fallback={fallback(label('bgInherit'))}
					label={label('bg')}
					onReset={() => write('bg')}
					resetLabel={resetLabel('bg')}
					stated={bgStated}
					testId="scene-settings-bg"
				>
					<TextSelect
						onChange={event => {
							const value = event.target.value;

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
							...bgNames.map(name => ({label: name, value: name}))
						]}
						value={bgId}
					>
						{label('bg')}
					</TextSelect>
				</SettingRow>
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

			<div className="scene-preview-beat-props-group">
				<h4 className="scene-preview-beat-props-heading">{label('arrival')}</h4>
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
				<h4 className="scene-preview-beat-props-heading">{label('pacing')}</h4>
				<SettingRow
					fallback={fallback(label('autoAdvanceInherit'))}
					label={label('autoAdvance')}
					onReset={() => write('autoAdvance')}
					resetLabel={resetLabel('autoAdvance')}
					stated={scene.autoAdvance !== undefined}
					testId="scene-settings-auto-advance"
				>
					<NumberField
						label={label('autoAdvance')}
						min={0}
						onCommit={seconds =>
							write(
								'autoAdvance',
								seconds === undefined ? undefined : formatNumber(seconds)
							)
						}
						step={0.5}
						unit="s"
						value={scene.autoAdvance}
					/>
				</SettingRow>
				<SettingRow
					fallback={fallback(label('easeInherit'))}
					label={label('ease')}
					onReset={() => write('ease')}
					resetLabel={resetLabel('ease')}
					stated={scene.ease !== undefined}
					testId="scene-settings-ease"
				>
					<TextSelect
						onChange={event => {
							const value = event.target.value;

							// The map form is a readout, not a value to write back.
							if (value === CUSTOM) {
								return;
							}

							write('ease', value ? formatValue('ease', value) : undefined);
						}}
						options={[
							unsetOption,
							...(ease === CUSTOM ? [customOption('easePerKind')] : []),
							...withCurrent(
								EASE_NAMES,
								ease === CUSTOM ? undefined : ease || undefined
							).map(name => ({label: name, value: name}))
						]}
						value={ease}
					>
						{label('ease')}
					</TextSelect>
				</SettingRow>
			</div>

			<div
				className="scene-preview-beat-props-group"
				data-testid="scene-settings-fx-group"
			>
				<h4 className="scene-preview-beat-props-heading">{label('fx')}</h4>
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

			<div
				className="scene-preview-beat-props-group"
				data-testid="scene-settings-music-group"
			>
				<h4 className="scene-preview-beat-props-heading">{label('music')}</h4>
				<SettingRow
					fallback={fallback(label('musicInherit'))}
					label={label('musicSound')}
					onReset={() => write('music')}
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
								write('music');
							} else if (value === NONE) {
								write('music', formatMusic(null));
							} else if (main) {
								// Same bed, another sound: its volume, loop and fade stay.
								write(
									'music',
									formatMusic({
										...music!,
										tracks: {[MUSIC_MAIN_TRACK]: {...main, id: value}}
									})
								);
							} else {
								write('music', formatValue('music', value));
							}
						}}
						options={[
							unsetOption,
							{label: label('musicSilence'), value: NONE},
							...(musicChoice === CUSTOM ? [customOption('musicTracks')] : []),
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
							write('music', formatMusic({...music, stopOthers: undefined}))
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

								write(
									'music',
									formatMusic({
										...music,
										stopOthers: value === 'all' ? 'all' : undefined
									})
								);
							}}
							options={[
								unsetOption,
								...(stopChoice === CUSTOM
									? [{label: (stop as string[]).join(', '), value: CUSTOM}]
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

			<div
				className="scene-preview-beat-props-group"
				data-testid="scene-settings-bubble-group"
			>
				<h4 className="scene-preview-beat-props-heading">{label('bubble')}</h4>
				<SettingRow {...bubbleRow('as')}>
					<PreviewSelect
						onChange={value => setBubble('as', value || null)}
						options={bubbleStyleOptions({
							colors: {
								accent: bubble.accent,
								bg: bubble.bg,
								color: bubble.color,
								font: bubble.font
							},
							emptyLabel: label('unset')
						})}
						value={bubble.as ?? UNSET}
					>
						{label('bubble_as')}
					</PreviewSelect>
				</SettingRow>
				<SettingRow {...bubbleRow('font')}>
					<PreviewSelect
						onChange={value => setBubble('font', value || null)}
						options={bubbleFontOptions({
							current: bubble.font,
							customLabel: label('fontCustom'),
							emptyLabel: label('unset'),
							emptyPreview: (
								<BubbleFontSwatch
									label={label('fontSample')}
									stack={bubbleFontStack(undefined)}
								/>
							)
						})}
						searchable
						value={bubble.font ?? UNSET}
					>
						{label('bubble_font')}
					</PreviewSelect>
				</SettingRow>
				{(['color', 'bg', 'accent'] as const).map(name => (
					<SettingRow {...bubbleRow(name)} key={name}>
						<BubbleColorControl
							clearLabel={label('clearColor')}
							onChange={value => setBubble(name, value ?? null)}
							value={bubble[name]}
						>
							{label(`bubble_${name}`)}
						</BubbleColorControl>
					</SettingRow>
				))}
				{(
					[
						['place', BUBBLE_PLACES],
						['sizing', BUBBLE_SIZINGS],
						['anchor', BUBBLE_ANCHORS]
					] as const
				).map(([name, values]) => (
					<SettingRow {...bubbleRow(name)} key={name}>
						<TextSelect
							onChange={event => setBubble(name, event.target.value || null)}
							options={[
								unsetOption,
								...(values as readonly string[]).map(value => ({
									label: value,
									value
								}))
							]}
							value={(bubble[name] as string | undefined) ?? UNSET}
						>
							{label(`bubble_${name}`)}
						</TextSelect>
					</SettingRow>
				))}
			</div>

			<div className="scene-preview-beat-props-group">
				<h4 className="scene-preview-beat-props-heading">{label('editor')}</h4>
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
		</div>
	);
};

/**
 * The panel as the sidebar's settings tab mounts it: the asset name lists come from the
 * library here, so only an open settings tab pays for listing the library.
 */
export const SceneSettingsTab: React.FC<
	Omit<SceneSettingsPanelProps, 'assetNames'>
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

	return <SceneSettingsPanel {...props} assetNames={assetNames} />;
};
