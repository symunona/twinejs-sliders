/**
 * Object link: the selected entity's own `link:` and `highlight:`, in the Links tab.
 *
 * The Links tab holds two different things under one handle. Nothing selected, it is the
 * scene's `links:` block (`scene-links-panel.tsx`). One entity selected, it is THAT
 * entity's way out — a different key, on a different line of YAML, inherited beat to beat
 * like `pose`. The two were easy to mistake for each other, so this mode is loud: own
 * header, accent colour, own tab icon and label, and a way back to the scene's list.
 *
 * Both keys are STATE. On a beat, clearing cannot be said by deleting (the beat inherits
 * what the one before it left), so a clear writes `link: ~` / `highlight: ~` there — the
 * `reset: null` of `motionWrites`.
 *
 * Single selection only: two doors rarely lead to the same place, and a picker showing one
 * target for several would be showing a guess.
 */

import {
	IconAlertTriangle,
	IconArrowBackUp,
	IconExternalLink,
	IconFilePlus,
	IconHandFinger
} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {matchPassageName} from '@sliders/scene-types';
import type {Scene, StageEntity} from '@sliders/scene-types';
import {IconButton} from '../../../components/control/icon-button';
import {isInternalLink} from '../../../util/parse-links';
import {BubbleColorControl} from '../../bubble-style/bubble-color-control';
import {MiniButton, Row, TextField} from './scene-links-panel';
import type {EntityKeyWrite} from './use-scene-writer';
import './beat-props.css';
import './scene-links-panel.css';
import './object-link-panel.css';

export interface ObjectLinkPanelProps {
	/** The selection, resolved on the beat on screen. Only a single one is editable. */
	entities: StageEntity[];
	/** `parse.result?.scene`: its `links:` entries are pickable targets too. */
	scene: Scene | undefined;
	/** Scrubber position. 0 writes the entry, anything else the beat. */
	beat: number;
	editable: boolean;
	passageNames: string[];
	/** Colours the story already uses, for the highlight well. */
	swatches?: string[];
	/** Parent calls `commit(writes, EDIT_ORIGIN)`. */
	onWrite: (writes: EntityKeyWrite[]) => void;
	onOpenPassage?: (name: string) => void;
	onCreatePassage?: (name: string) => void;
	/** Clears the selection, which turns this tab back into the scene's links. */
	onShowSceneLinks?: () => void;
}

// ---------------------------------------------------------------------------
// Writes — pure, so the YAML each control writes is checked without a DOM.
// ---------------------------------------------------------------------------

/** What `link:` says, as the author would type it: the `links:` entry, else the passage. */
export function entityLinkText(entity: StageEntity | undefined): string {
	return entity?.link?.name ?? entity?.link?.to ?? '';
}

/**
 * Point `link:` somewhere, or stop it. `undefined` removes the key on the entry and writes
 * `link: ~` on a beat.
 *
 * A direct passage link's own `if:` survives a new target — the condition is about the
 * object, not the room behind it. A named entry's `if:` is the entry's, copied in by the
 * parser, and is never written onto the entity.
 */
export function entityLinkWrites(
	entity: StageEntity | undefined,
	target: string | undefined
): EntityKeyWrite[] {
	if (!entity) {
		return [];
	}

	const own = entity.link?.name === undefined ? entity.link?.if : undefined;

	return [
		{
			id: entity.id,
			key: 'link',
			kind: entity.kind,
			ref: entity.ref,
			reset: null,
			value:
				target === undefined
					? undefined
					: own === undefined
					? target
					: {if: own, to: target}
		}
	];
}

/** Set or clear `highlight:`. Same rule as `link:`: cleared on a beat is `highlight: ~`. */
export function entityHighlightWrites(
	entity: StageEntity | undefined,
	highlight: string | undefined
): EntityKeyWrite[] {
	if (!entity) {
		return [];
	}

	const value = highlight?.trim();

	return [
		{
			id: entity.id,
			key: 'highlight',
			kind: entity.kind,
			ref: entity.ref,
			reset: null,
			value: value ? value : undefined
		}
	];
}

let datalistCount = 0;

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export const ObjectLinkPanel: React.FC<ObjectLinkPanelProps> = ({
	beat,
	editable,
	entities,
	onCreatePassage,
	onOpenPassage,
	onShowSceneLinks,
	onWrite,
	passageNames,
	scene,
	swatches
}) => {
	const {t} = useTranslation();
	const [listId] = React.useState(
		() => `object-link-targets-${++datalistCount}`
	);
	const label = (name: string, options?: Record<string, unknown>) =>
		t(`dialogs.passageEdit.scenePreview.objectLink.${name}`, options);
	const entity = entities.length === 1 ? entities[0] : undefined;
	const back = onShowSceneLinks && (
		<div className="object-link-back">
			<IconButton
				icon={<IconArrowBackUp />}
				label={label('showScene')}
				onClick={onShowSceneLinks}
				variant="secondary"
			/>
		</div>
	);

	const header = (
		<div className="object-link-header">
			<IconHandFinger />
			<span className="object-link-title">
				{entity
					? label('title', {id: entity.id})
					: label('titleMany', {count: entities.length})}
			</span>
		</div>
	);

	if (!entity) {
		return (
			<div className="object-link-panel" data-testid="object-link-panel">
				{header}
				<p className="object-link-note">{label('singleOnly')}</p>
				<p className="object-link-note">{label('sceneHint')}</p>
				{back}
			</div>
		);
	}

	const text = entityLinkText(entity);
	const linked = text !== '';
	const named = entity.link?.name;
	const entry = named !== undefined ? scene?.links[named] : undefined;
	const to = entity.link?.to ?? entry?.to;
	const passage =
		to && isInternalLink(to) ? matchPassageName(passageNames, to) : undefined;
	const external = !!to && !isInternalLink(to);
	const missing = linked && !passage && !external;
	const entryNames = Object.keys(scene?.links ?? {});
	const write = (writes: EntityKeyWrite[]) => editable && onWrite(writes);

	return (
		<div
			className={classNames('object-link-panel', 'scene-links-panel')}
			data-testid="object-link-panel"
		>
			{header}
			<p className="object-link-note">
				{beat > 0 ? label('scopeBeat', {beat}) : label('scopeEntry')}
			</p>

			<datalist id={listId}>
				{entryNames.map(name => (
					<option
						key={`entry-${name}`}
						label={label('entryOption', {name, to: scene!.links[name].to})}
						value={name}
					/>
				))}
				{passageNames
					.filter(name => !entryNames.includes(name))
					.map(name => (
						<option key={name} value={name} />
					))}
			</datalist>

			<div className="scene-preview-beat-props-group">
				<Row
					className={classNames({'scene-links-missing': missing})}
					label={label('target')}
					onReset={
						editable
							? () => write(entityLinkWrites(entity, undefined))
							: undefined
					}
					resetLabel={label('clear')}
					stated={linked}
					testId="object-link-target"
				>
					<TextField
						disabled={!editable}
						label={label('target')}
						list={listId}
						onCommit={next => write(entityLinkWrites(entity, next))}
						placeholder={label('none')}
						value={text}
					/>
					{missing && (
						<span
							aria-label={label('missing', {name: to ?? text})}
							className="scene-links-warning"
							role="img"
							title={label('missing', {name: to ?? text})}
						>
							<IconAlertTriangle />
						</span>
					)}
					{missing && editable && onCreatePassage && (to ?? text) !== '' && (
						<MiniButton
							label={label('create', {name: to ?? text})}
							onClick={() => onCreatePassage(to ?? text)}
						>
							<IconFilePlus />
						</MiniButton>
					)}
					{passage && onOpenPassage && (
						<MiniButton
							label={label('open', {name: passage})}
							onClick={() => onOpenPassage(passage)}
						>
							<IconExternalLink />
						</MiniButton>
					)}
				</Row>
				{!linked && <p className="object-link-note">{label('scenery')}</p>}
				{named !== undefined && (
					<p className="object-link-note" data-testid="object-link-entry">
						{entry?.if
							? label('viaEntryIf', {cond: entry.if, name: named, to: to ?? ''})
							: label('viaEntry', {name: named, to: to ?? ''})}
					</p>
				)}
				{linked && (
					<Row
						label={label('highlight')}
						stated={entity.highlight !== undefined}
						testId="object-link-highlight"
					>
						<BubbleColorControl
							clearLabel={label('clearHighlight')}
							disabled={!editable}
							editable
							onChange={value => write(entityHighlightWrites(entity, value))}
							placeholder={label('highlightDefault')}
							swatches={swatches}
							swatchesLabel={label('storyColors')}
							value={entity.highlight}
						>
							{label('highlight')}
						</BubbleColorControl>
					</Row>
				)}
			</div>

			<p className="object-link-note">{label('sceneHint')}</p>
			{back}
		</div>
	);
};
