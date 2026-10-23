/**
 * The stage's right-hand sidebar: one collapsible stripe holding every panel the preview
 * has — scene settings, layers, the beat, the selection, walk-here, problems.
 *
 * One slot, tabbed, rather than a panel per toggle in the bar: the panels used to fight
 * over the same slot anyway (the last one asked for won), and a bar of toggles was a bar
 * of hidden state. Tabs say what is there.
 *
 * Collapsed, it is a thin stripe: the toggle and the tab icons, stacked. A click on a tab
 * icon opens straight onto that tab. Open, the icons run across the top (Blender's
 * properties editor) and the toggle sits at their head (Inkscape's dock).
 *
 * A tab whose edits follow the scrubber says so on its handle (`scope`): gray while it
 * writes the scene's globals (Step 0), blue while it writes the beat on screen.
 *
 * Stateless. `useSceneSidebar` holds which tab and whether open, remembered.
 */

import {
	IconLayoutSidebarRightCollapse,
	IconLayoutSidebarRightExpand
} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/control/icon-button';
import './scene-sidebar.css';

export type SceneSidebarTabId =
	| 'scene'
	| 'camera'
	| 'sounds'
	| 'layers'
	| 'beat'
	| 'selection'
	| 'transform'
	| 'particles'
	| 'walk'
	| 'links'
	| 'problems';

/**
 * Where a scope-aware tab's edits land right now. `global`: the scene's own keys, every
 * beat's default. `beat`: the beat on screen, overriding them. Absent: not scope-aware.
 */
export type SceneSidebarTabScope = 'global' | 'beat';

export interface SceneSidebarTab {
	id: SceneSidebarTabId;
	scope?: SceneSidebarTabScope;
	/**
	 * The handle is recoloured. `selection`: a tab that only exists while something is
	 * selected (`transform`), orange so it is noticed the moment it is there. `object`: the
	 * Links tab editing the selected entity's own `link:`, purple.
	 */
	accent?: 'selection' | 'object';
	icon: React.ReactNode;
	label: string;
	/** Drawn only while this tab is the open one. */
	content: React.ReactNode;
}

export interface SceneSidebarProps {
	/** Shown tabs, in order. The active one must be among them, else the first is shown. */
	tabs: SceneSidebarTab[];
	active: SceneSidebarTabId;
	open: boolean;
	onActive: (id: SceneSidebarTabId) => void;
	onOpenChange: (open: boolean) => void;
}

const OPEN_KEY = 'sliders.preview.sidebar.open';
const TAB_KEY = 'sliders.preview.sidebar.tab';

/**
 * Tabs that are a place to come back to. `selection`, `transform` and `problems` are
 * moments: each exists only while there is a selection or an error.
 */
const REMEMBERED: SceneSidebarTabId[] = [
	'scene',
	'camera',
	'sounds',
	'layers',
	'beat',
	'walk',
	'links'
];

/**
 * Open and tab, both remembered across dialogs and sessions like the grid and the lock:
 * an author who closed the sidebar wants the stage, and that outlasts one passage.
 *
 * `selection` is never written as the remembered tab — it follows the selection, and
 * coming back to an empty selection tab would be coming back to nothing.
 */
export function useSceneSidebar(): {
	active: SceneSidebarTabId;
	open: boolean;
	setActive: (id: SceneSidebarTabId) => void;
	setOpen: (open: boolean) => void;
} {
	const [open, setOpenState] = React.useState(
		() => window.localStorage.getItem(OPEN_KEY) !== 'false'
	);
	const [active, setActiveState] = React.useState<SceneSidebarTabId>(() => {
		const stored = window.localStorage.getItem(TAB_KEY) as SceneSidebarTabId;

		return REMEMBERED.includes(stored) ? stored : 'scene';
	});
	const setOpen = React.useCallback((next: boolean) => {
		window.localStorage.setItem(OPEN_KEY, String(next));
		setOpenState(next);
	}, []);
	const setActive = React.useCallback((id: SceneSidebarTabId) => {
		if (REMEMBERED.includes(id)) {
			window.localStorage.setItem(TAB_KEY, id);
		}

		setActiveState(id);
	}, []);

	return {active, open, setActive, setOpen};
}

export const SceneSidebar: React.FC<SceneSidebarProps> = props => {
	const {active, onActive, onOpenChange, open, tabs} = props;
	const {t} = useTranslation();
	const shown = tabs.find(tab => tab.id === active) ?? tabs[0];

	return (
		<div
			className={classNames('scene-sidebar', {open})}
			data-testid="scene-sidebar"
		>
			<div className="scene-sidebar-tabs" role="tablist">
				<IconButton
					icon={
						open ? (
							<IconLayoutSidebarRightCollapse />
						) : (
							<IconLayoutSidebarRightExpand />
						)
					}
					iconOnly
					label={t(
						open
							? 'dialogs.passageEdit.scenePreview.sidebar.collapse'
							: 'dialogs.passageEdit.scenePreview.sidebar.expand'
					)}
					onClick={() => onOpenChange(!open)}
					tooltipPosition={open ? 'bottom' : 'left'}
				/>
				{tabs.map(tab => {
					const handle = (
						<IconButton
							icon={tab.icon}
							iconOnly
							key={tab.id}
							label={tab.label}
							onClick={() => {
								// A click on the open tab collapses, like Blender's: the icon is
								// the panel's handle either way.
								if (open && tab.id === shown?.id) {
									onOpenChange(false);

									return;
								}

								onActive(tab.id);
								onOpenChange(true);
							}}
							role="tab"
							selectable
							selected={open && tab.id === shown?.id}
							tooltipPosition={open ? 'bottom' : 'left'}
						/>
					);

					// IconButton takes no class, so a scoped or accented handle is wrapped.
					return tab.scope || tab.accent ? (
						<span
							className={classNames({
								'scene-sidebar-tab-accent': tab.accent,
								'scene-sidebar-tab-scope': tab.scope
							})}
							data-accent={tab.accent}
							data-scope={tab.scope}
							data-testid={`scene-sidebar-tab-${tab.id}`}
							key={tab.id}
						>
							{handle}
						</span>
					) : (
						handle
					);
				})}
			</div>
			{open && shown && (
				<div
					className="scene-sidebar-body"
					data-tab={shown.id}
					role="tabpanel"
				>
					{shown.content}
				</div>
			)}
		</div>
	);
};
