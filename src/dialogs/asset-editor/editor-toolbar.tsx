import {IconAdjustments, IconResize, IconWand} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBarSeparator} from '../../components/container/button-bar';
import {IconButton} from '../../components/control/icon-button';

/**
 * Which set of controls the right pane is showing.
 *
 * One tool at a time, rather than every section stacked: the pane used to be six
 * groups deep, so the control being reached for was usually below the fold and the
 * one above it was in the way.
 */
export type ToolId = 'adjust' | 'size' | 'background';

export const TOOL_IDS: ToolId[] = ['adjust', 'size', 'background'];

const TOOL_ICONS: Record<ToolId, React.ReactNode> = {
	adjust: <IconAdjustments />,
	background: <IconWand />,
	size: <IconResize />
};

export interface EditorToolbarProps {
	/**
	 * The save buttons. Handed in rather than built here: both carry prompts whose
	 * open state, validation and name field belong to the editor.
	 */
	actions: React.ReactNode;
	/** True while the image has an edit on it that nothing has written down yet. */
	dirty: boolean;
	/** Opens the generator on this asset. Absent when there is no asset to attach. */
	onGenerate?: () => void;
	onSelectTool: (tool: ToolId) => void;
	/** Explains what attaching this asset to the generator will actually send. */
	generateHint?: string;
	/** Shown under the bar--the save note, whose button sits in it. */
	note?: React.ReactNode;
	/** The note button that reveals `note`. */
	noteButton?: React.ReactNode;
	tool: ToolId;
	/** Which tools this image can use. Detached editing has no anchor, but still sizes. */
	tools?: ToolId[];
}

/**
 * The bar across the top of the asset editor: what to do with the edit on the left,
 * which tool is being used on the right.
 *
 * Saving used to be the last section of a scrolling pane, which put the two buttons
 * that end the dialog below everything that is only ever a step towards them.
 */
export const EditorToolbar: React.FC<EditorToolbarProps> = props => {
	const {
		actions,
		dirty,
		generateHint,
		note,
		noteButton,
		onGenerate,
		onSelectTool,
		tool,
		tools = TOOL_IDS
	} = props;
	const {t} = useTranslation();

	return (
		<div className="asset-editor-toolbar">
			<div className="asset-editor-toolbar-row">
				{actions}
				<span
					className={classNames('asset-editor-dirty', {dirty})}
					data-testid="asset-editor-dirty"
					// Polite, because it changes on every slider drag: an assertive
					// region would interrupt the value being read out.
					role="status"
				>
					{t(
						dirty
							? 'dialogs.assetEditor.unsavedChanges'
							: 'dialogs.assetEditor.noChanges'
					)}
				</span>
				{noteButton}
				{onGenerate && (
					<>
						<ButtonBarSeparator />
						<IconButton
							icon={<IconWand />}
							label={t('dialogs.assetEditor.generateWith')}
							onClick={onGenerate}
							tooltipLabel={generateHint}
						/>
					</>
				)}
				<ButtonBarSeparator />
				<div
					aria-label={t('dialogs.assetEditor.toolsLabel')}
					className="asset-editor-tools"
					role="radiogroup"
				>
					{tools.map(id => (
						<IconButton
							ariaChecked={tool === id}
							icon={TOOL_ICONS[id]}
							key={id}
							label={t(`dialogs.assetEditor.tool.${id}`)}
							onClick={() => onSelectTool(id)}
							role="radio"
							// `selected` alone, not `selectable`: that prop adds
							// `aria-pressed`, which a radio must not carry on top of
							// `aria-checked`.
							selected={tool === id}
							// Becomes the button's accessible name, so the hint names the
							// tool rather than only listing what is inside it.
							tooltipLabel={t(`dialogs.assetEditor.toolHint.${id}`)}
						/>
					))}
				</div>
			</div>
			{note}
		</div>
	);
};
