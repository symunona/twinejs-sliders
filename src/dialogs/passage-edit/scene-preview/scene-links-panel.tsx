/**
 * Scene links: the `links:` map and the `linkList:` block, edited beside the stage.
 *
 * Same grid as the scene settings (`scene-settings-panel.tsx`): label, control, X. Every
 * write REPLACES the whole key's value (`setSceneKey`), rebuilt from the parsed scene, so a
 * block-style `links:` comes back as one flow line — the documented cost of `setSceneKey`,
 * confined to the key being edited.
 *
 * Entry form: the shorthand `stay: Tavern` whenever `to:` is all the entry says, the map
 * `leave: {to: Street, if: has_coin}` otherwise. `Scene` does not record which form was
 * written, so "keep each entry's form" is not possible; this is the rule the spec's own
 * example follows, and both forms parse to the same `SceneLink`.
 *
 * Inline links: the parser merges every `[[stay->Tavern]]` in beat text into
 * `scene.links`. Rebuilding `links:` from that naively would copy each one into the map —
 * a target written twice, the second copy silently winning once the beat is retyped. So an
 * entry whose target is the inline one is written WITHOUT `to:` (or not at all, when it
 * has no props), and the parser fills it back in. Its name is the beat's, so it cannot be
 * renamed or removed here. Reordering is the exception: an omitted entry has no position
 * in the map, so a move writes every entry out in full.
 *
 * Text fields commit on blur and on Enter, never per keystroke: each write is a CodeMirror
 * edit and a reparse. Escape puts back what the scene says.
 */

import {
	IconAlertTriangle,
	IconArrowDown,
	IconArrowUp,
	IconExternalLink,
	IconFilePlus,
	IconPlus,
	IconX
} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {scanWikiLinks} from '@sliders/scene-schema';
import {formatValue, formatNumber} from '@sliders/scene-edit';
import {matchPassageName} from '@sliders/scene-types';
import type {
	LinkListShow,
	LinkListStyle,
	Scene,
	SceneLink
} from '@sliders/scene-types';
import {CheckboxButton} from '../../../components/control/checkbox-button';
import {IconButton} from '../../../components/control/icon-button';
import {TextInput} from '../../../components/control/text-input';
import {TextSelect} from '../../../components/control/text-select';
import {isInternalLink} from '../../../util/parse-links';
import type {SceneKeyWrite} from './use-scene-writer';
import './beat-props.css';
import './scene-links-panel.css';

export interface SceneLinksPanelProps {
	/** `parse.result?.scene`. Absent renders nothing — no scene, no links. */
	scene: Scene | undefined;
	/** False: a read-only list, no controls. */
	editable: boolean;
	/** Story passages: the target picker's options, and what "missing" is checked against. */
	passageNames: string[];
	/** Parent calls `commit(writes, EDIT_ORIGIN)`. */
	onWrite: (writes: SceneKeyWrite[]) => void;
	/** Click-through on a target that names a passage. Absent: no button. */
	onOpenPassage?: (name: string) => void;
	/** Offered on a target that names no passage. Absent: the warning only. */
	onCreatePassage?: (name: string) => void;
}

/** The per-entry props a link can carry besides its target, in the spec's order. */
const LINK_PROPS = ['if', 'icon', 'transition'] as const;

type LinkProp = (typeof LINK_PROPS)[number];

/** The empty option: the scene states nothing, so the default (or the story) decides. */
const UNSET = '';

const SHOWS: LinkListShow[] = ['auto', 'always', 'never'];

// ---------------------------------------------------------------------------
// Formatting — pure, so the YAML each control writes is checked without a DOM.
// ---------------------------------------------------------------------------

/**
 * The target each name gets from an inline `[[name->Target]]` in beat text.
 *
 * Mirrors the parser's `collectLinks`: `say` and `box` text, beat order, first one wins.
 * A bare `[[name]]` supplies nothing and is not here.
 */
export function inlineLinkTargets(scene: Scene): Map<string, string> {
	const out = new Map<string, string>();

	for (const beat of scene.beats) {
		if (beat.kind !== 'say' && beat.kind !== 'box') {
			continue;
		}

		for (const link of scanWikiLinks(beat.text)) {
			if (link.target !== undefined && !out.has(link.name)) {
				out.set(link.name, link.target);
			}
		}
	}

	return out;
}

/**
 * `links:` back to one flow map. `undefined` when nothing is left to write: remove the key.
 *
 * `explicit` writes every entry in full, inline ones included — what a reorder needs,
 * because an entry left for the parser to fill in has no place in the map's order.
 */
export function formatLinks(
	links: readonly SceneLink[],
	inline: ReadonlyMap<string, string>,
	explicit = false
): string | undefined {
	const value: Record<string, unknown> = {};

	for (const link of links) {
		const fromBeat =
			!explicit && link.to !== '' && inline.get(link.name) === link.to;
		const props = LINK_PROPS.filter(prop => link[prop] !== undefined);

		if (fromBeat && props.length === 0) {
			continue;
		}

		if (props.length === 0 && link.to !== '') {
			value[link.name] = link.to;
			continue;
		}

		const entry: Record<string, unknown> = {};

		if (!fromBeat && link.to !== '') {
			entry.to = link.to;
		}

		for (const prop of props) {
			entry[prop] = link[prop];
		}

		value[link.name] = entry;
	}

	return Object.keys(value).length === 0
		? undefined
		: formatValue('links', value);
}

/**
 * `linkList:` back to one flow map, in the spec's key order. Never undefined: `{}` is the
 * block saying "on the stage, defaults for everything", and only the on-stage switch
 * removes the key.
 */
export function formatLinkList(style: LinkListStyle): string {
	const value: Record<string, unknown> = {
		at: style.at && [style.at.x, style.at.y],
		w: style.w,
		h: style.h,
		as: style.as,
		show: style.show,
		icon: style.icon,
		transition: style.transition
	};

	return formatValue('linkList', value);
}

/** A name not yet in the list: `base`, then `base 2`, `base 3`… */
export function uniqueLinkName(base: string, taken: Iterable<string>): string {
	const names = new Set(taken);

	if (!names.has(base)) {
		return base;
	}

	let n = 2;

	while (names.has(`${base} ${n}`)) {
		n++;
	}

	return `${base} ${n}`;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

interface RowProps {
	label: React.ReactNode;
	/** The scene states this. Highlights the row and enables the X. */
	stated?: boolean;
	/** Removes what the row owns. Absent: no X. */
	onReset?: () => void;
	resetLabel?: string;
	/** Disables the X with this as its tooltip, for a row whose value lives elsewhere. */
	resetBlocked?: string;
	className?: string;
	testId?: string;
}

/** One line of the grid, on the beat props' classes so the panels restyle together. */
export const Row: React.FC<RowProps> = ({
	children,
	className,
	label,
	onReset,
	resetBlocked,
	resetLabel,
	stated,
	testId
}) => (
	<div
		className={classNames('beat-prop-row', className, {overridden: stated})}
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
				disabled={!stated || !!resetBlocked}
				onClick={onReset}
				title={resetBlocked ?? resetLabel}
				type="button"
			>
				<IconX />
			</button>
		) : (
			<span />
		)}
	</div>
);

interface TextFieldProps {
	label: string;
	value: string | undefined;
	/** The trimmed text, or `undefined` when the box was emptied. */
	onCommit: (value: string | undefined) => void;
	disabled?: boolean;
	list?: string;
	placeholder?: string;
}

/**
 * A text box that writes on blur and Enter. Escape puts back what the scene says.
 *
 * Unchanged text writes nothing, so tabbing through the panel leaves no undo entries.
 */
export const TextField: React.FC<TextFieldProps> = ({
	disabled,
	label,
	list,
	onCommit,
	placeholder,
	value
}) => {
	const [draft, setDraft] = React.useState<string>();
	const shown = draft ?? value ?? '';

	// A reparse that changed the value under the box wins over a stale draft.
	React.useEffect(() => setDraft(undefined), [value]);

	function commit() {
		if (draft === undefined) {
			return;
		}

		setDraft(undefined);

		const trimmed = draft.trim();
		const next = trimmed === '' ? undefined : trimmed;

		if (next !== value) {
			onCommit(next);
		}
	}

	return (
		<TextInput
			disabled={disabled}
			list={list}
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
			value={shown}
		>
			{label}
		</TextInput>
	);
};

interface NumberFieldProps {
	label: string;
	value: number | undefined;
	onCommit: (value: number | undefined) => void;
	disabled?: boolean;
	min?: number;
	max?: number;
	step?: number;
}

/**
 * The settings panel's number box: blur and Enter commit, Escape reverts, emptied = removed.
 * Refuses what the parser would only reject back.
 */
const NumberField: React.FC<NumberFieldProps> = ({
	disabled,
	label,
	max,
	min,
	onCommit,
	step,
	value
}) => {
	const [draft, setDraft] = React.useState<string>();
	const shown = draft ?? (value === undefined ? '' : formatNumber(value));

	React.useEffect(() => setDraft(undefined), [value]);

	function commit() {
		if (draft === undefined) {
			return;
		}

		setDraft(undefined);

		const trimmed = draft.trim();

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
		<span className="scene-links-number">
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
				step={step}
				type="number"
				value={shown}
			>
				{label}
			</TextInput>
		</span>
	);
};

/** A small icon button in a row's control column. */
export const MiniButton: React.FC<{
	label: string;
	onClick: () => void;
	disabled?: boolean;
	className?: string;
}> = ({children, className, disabled, label, onClick}) => (
	<button
		aria-label={label}
		className={classNames('beat-prop-reset', 'scene-links-mini', className)}
		disabled={disabled}
		onClick={onClick}
		title={label}
		type="button"
	>
		{children}
	</button>
);

let datalistCount = 0;

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export const SceneLinksPanel: React.FC<SceneLinksPanelProps> = ({
	editable,
	onCreatePassage,
	onOpenPassage,
	onWrite,
	passageNames,
	scene
}) => {
	const {t} = useTranslation();
	// React 16 has no useId; one per mount is all the datalist needs.
	const [listId] = React.useState(
		() => `scene-links-passages-${++datalistCount}`
	);

	if (!scene) {
		return null;
	}

	const label = (name: string, options?: Record<string, unknown>) =>
		t(`dialogs.passageEdit.scenePreview.links.${name}`, options);
	const links = Object.values(scene.links);
	const inline = inlineLinkTargets(scene);

	/** Where a target leads: the passage it names, or why it names none. */
	function targetState(to: string) {
		if (to === '' || !isInternalLink(to)) {
			return {external: to !== ''};
		}

		return {passage: matchPassageName(passageNames, to)};
	}

	if (!editable) {
		return (
			<div className="scene-links-panel" data-testid="scene-links-panel">
				{links.length === 0 ? (
					<p className="scene-preview-beat-props-none">{label('none')}</p>
				) : (
					<ul className="scene-links-readonly">
						{links.map(link => {
							const state = targetState(link.to);
							const missing = !state.external && !state.passage;

							return (
								<li
									className={classNames({'scene-links-missing': missing})}
									data-testid={`scene-links-row-${link.name}`}
									key={link.name}
								>
									<span className="scene-links-name">{link.name}</span>
									{' → '}
									{state.passage && onOpenPassage ? (
										<button
											className="scene-links-target-link"
											onClick={() => onOpenPassage(state.passage!)}
											type="button"
										>
											{link.to}
										</button>
									) : (
										<span>{link.to}</span>
									)}
									{link.if && (
										<span className="scene-links-if"> if {link.if}</span>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</div>
		);
	}

	const writeLinks = (next: SceneLink[], explicit = false) =>
		onWrite([
			{formatted: formatLinks(next, inline, explicit), sceneKey: 'links'}
		]);
	const patchLink = (index: number, patch: Partial<SceneLink>) =>
		writeLinks(
			links.map((link, i) => (i === index ? {...link, ...patch} : link))
		);
	const move = (index: number, by: number) => {
		const next = [...links];
		const [link] = next.splice(index, 1);

		next.splice(index + by, 0, link);
		writeLinks(next, true);
	};
	const add = () => {
		// The spec's idiom (Ctrl-Space under `links:`): the label starts as the target's
		// own name. A real passage, so the new entry parses clean instead of arriving
		// as a "no target" error.
		const to = passageNames[0] ?? label('newTarget');

		writeLinks([
			...links,
			{
				name: uniqueLinkName(
					to,
					links.map(link => link.name)
				),
				to
			}
		]);
	};

	const linkList = scene.linkList;
	const writeLinkList = (style: LinkListStyle | undefined) =>
		onWrite([
			{
				formatted: style && formatLinkList(style),
				sceneKey: 'linkList'
			}
		]);
	const patchList = (patch: Partial<LinkListStyle>) =>
		writeLinkList({...linkList, ...patch});
	const listRow = (
		key: keyof LinkListStyle,
		control: React.ReactNode,
		rowLabel = label(key)
	) => (
		<Row
			label={rowLabel}
			onReset={() => patchList({[key]: undefined})}
			resetLabel={label('reset', {name: rowLabel})}
			stated={linkList?.[key] !== undefined}
			testId={`scene-links-list-${key}`}
		>
			{control}
		</Row>
	);

	return (
		<div className="scene-links-panel" data-testid="scene-links-panel">
			<datalist id={listId}>
				{passageNames.map(name => (
					<option key={name} value={name} />
				))}
			</datalist>

			<div className="scene-preview-beat-props-group">
				<h4 className="scene-preview-beat-props-heading">
					{label('listHeading')}
				</h4>
				<Row
					label={label('onStage')}
					stated={!!linkList}
					testId="scene-links-list-on-stage"
				>
					<CheckboxButton
						label={linkList ? label('onStageYes') : label('onStageNo')}
						onChange={on => writeLinkList(on ? {} : undefined)}
						tooltipLabel={label('onStageDetail')}
						value={!!linkList}
					/>
				</Row>
				{linkList && (
					<>
						{listRow(
							'show',
							<TextSelect
								onChange={event =>
									patchList({
										show: (event.target.value || undefined) as
											| LinkListShow
											| undefined
									})
								}
								options={[
									{label: label('showUnset'), value: UNSET},
									...SHOWS.map(show => ({
										label: label(`show_${show}`),
										value: show
									}))
								]}
								value={linkList.show ?? UNSET}
							>
								{label('show')}
							</TextSelect>
						)}
						{listRow(
							'at',
							<>
								<NumberField
									label={label('atX')}
									onCommit={x =>
										patchList({
											at:
												x === undefined
													? undefined
													: {x, y: linkList.at?.y ?? 0.86}
										})
									}
									step={0.01}
									value={linkList.at?.x}
								/>
								<NumberField
									label={label('atY')}
									onCommit={y =>
										patchList({
											at:
												y === undefined
													? undefined
													: {x: linkList.at?.x ?? 0.5, y}
										})
									}
									step={0.01}
									value={linkList.at?.y}
								/>
							</>
						)}
						{(['w', 'h'] as const).map(key =>
							listRow(
								key,
								<NumberField
									label={label(key)}
									max={1}
									min={0.01}
									onCommit={value => patchList({[key]: value})}
									step={0.05}
									value={linkList[key]}
								/>
							)
						)}
						{(['as', 'icon', 'transition'] as const).map(key =>
							listRow(
								key,
								<TextField
									label={label(key)}
									onCommit={value => patchList({[key]: value})}
									value={linkList[key]}
								/>
							)
						)}
					</>
				)}
			</div>

			<div className="scene-preview-beat-props-group">
				<h4 className="scene-preview-beat-props-heading">{label('heading')}</h4>
				{links.length === 0 && (
					<p className="scene-preview-beat-props-none">{label('none')}</p>
				)}
				{links.map((link, index) => {
					const inlineTo = inline.get(link.name);
					const fromBeat = inlineTo !== undefined;
					const state = targetState(link.to);
					const missing = !state.external && !state.passage;

					return (
						<div
							className="scene-links-entry"
							data-testid={`scene-links-row-${link.name}`}
							key={link.name}
						>
							<Row
								label={label('name')}
								onReset={() => writeLinks(links.filter((_, i) => i !== index))}
								resetBlocked={fromBeat ? label('inBeat') : undefined}
								resetLabel={label('remove', {name: link.name})}
								stated
							>
								<TextField
									disabled={fromBeat}
									label={label('name')}
									onCommit={name => {
										// Empty or taken would drop an entry or merge two.
										if (name && !links.some(other => other.name === name)) {
											patchLink(index, {name});
										}
									}}
									value={link.name}
								/>
								<MiniButton
									disabled={index === 0}
									label={label('moveUp', {name: link.name})}
									onClick={() => move(index, -1)}
								>
									<IconArrowUp />
								</MiniButton>
								<MiniButton
									disabled={index === links.length - 1}
									label={label('moveDown', {name: link.name})}
									onClick={() => move(index, 1)}
								>
									<IconArrowDown />
								</MiniButton>
							</Row>
							<Row
								className={classNames({'scene-links-missing': missing})}
								label={label('to')}
								testId={`scene-links-to-${link.name}`}
							>
								<TextField
									label={label('to')}
									list={listId}
									onCommit={to => to && patchLink(index, {to})}
									value={link.to}
								/>
								{missing && (
									<span
										className="scene-links-warning"
										role="img"
										aria-label={label('missing', {name: link.to})}
										title={label('missing', {name: link.to})}
									>
										<IconAlertTriangle />
									</span>
								)}
								{missing && onCreatePassage && link.to !== '' && (
									<MiniButton
										label={label('create', {name: link.to})}
										onClick={() => onCreatePassage(link.to)}
									>
										<IconFilePlus />
									</MiniButton>
								)}
								{state.passage && onOpenPassage && (
									<MiniButton
										label={label('open', {name: state.passage})}
										onClick={() => onOpenPassage(state.passage!)}
									>
										<IconExternalLink />
									</MiniButton>
								)}
							</Row>
							{fromBeat && link.to !== inlineTo && (
								<p className="scene-links-note">
									{label('overridesBeat', {target: inlineTo})}
								</p>
							)}
							{LINK_PROPS.map((prop: LinkProp) => (
								<Row
									key={prop}
									label={label(prop)}
									onReset={() => patchLink(index, {[prop]: undefined})}
									resetLabel={label('reset', {name: label(prop)})}
									stated={link[prop] !== undefined}
									testId={`scene-links-${prop}-${link.name}`}
								>
									<TextField
										label={label(prop)}
										onCommit={value => patchLink(index, {[prop]: value})}
										value={link[prop]}
									/>
								</Row>
							))}
						</div>
					);
				})}
				<div className="scene-links-add">
					<IconButton icon={<IconPlus />} label={label('add')} onClick={add} />
				</div>
			</div>
		</div>
	);
};
