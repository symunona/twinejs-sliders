import {IconHelp} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {Tab, TabList, TabPanel, Tabs} from 'react-tabs';
import {IconButton} from '../control/icon-button';
import {Tooltip} from '../tooltip';
import {CommandKeyChip} from '../../hotkeys';
import {BackButton} from './back-button';
import './route-toolbar.css';

/**
 * A tab-row entry that is not a tab: one click runs it, there is no panel. For things
 * opened so often they earn a place beside the tabs, like the asset manager.
 */
export interface RouteToolbarLink {
	/** Its shortcut is shown in a tooltip on hover. */
	commandId?: string;
	onClick: () => void;
}

function isRouteToolbarLink(value: unknown): value is RouteToolbarLink {
	return (
		typeof value === 'object' &&
		value !== null &&
		!React.isValidElement(value) &&
		typeof (value as RouteToolbarLink).onClick === 'function'
	);
}

const TabLink: React.FC<{
	label: string;
	link: RouteToolbarLink;
	order: number;
}> = props => {
	const {label, link, order} = props;
	const [anchor, setAnchor] = React.useState<HTMLButtonElement | null>(null);

	return (
		<>
			<button
				className="route-toolbar-tab route-toolbar-tab-link"
				onClick={link.onClick}
				ref={setAnchor}
				style={{order}}
				type="button"
			>
				{label}
			</button>
			{link.commandId && (
				<Tooltip
					anchor={anchor}
					keys={<CommandKeyChip commandId={link.commandId} />}
					position="bottom"
				/>
			)}
		</>
	);
};

export interface RouteToolbarProps {
	helpUrl?: string;
	/**
	 * Shown on the top row, immediately after the tabs and left-aligned--the
	 * pinned controls opposite it are pushed to the right edge.
	 */
	leadingControls?: React.ReactNode;
	pinnedControls?: React.ReactNode;
	/**
	 * Shown on the second row, immediately after the selected tab's buttons.
	 * This is where ambient state that isn't an action belongs--who else is in
	 * the story, whether sync is connected--so that it sits beside the buttons
	 * instead of competing with them for the top row.
	 */
	statusControls?: React.ReactNode;
	/** Shown on the second row, pushed to its right edge. */
	trailingControls?: React.ReactNode;
	/** Tab label → panel, or a `RouteToolbarLink` for a one-click entry with no panel. */
	tabs: Record<string, React.ReactNode | RouteToolbarLink>;
}

export const RouteToolbar: React.FC<RouteToolbarProps> = props => {
	const {
		helpUrl = 'https://twinery.org/2guide',
		leadingControls,
		pinnedControls,
		statusControls,
		trailingControls,
		tabs
	} = props;
	const {t} = useTranslation();
	const tabEntries = Object.entries(tabs);

	return (
		<div className="route-toolbar">
			{/* forceRenderTabPanel keeps every tab's buttons mounted, which is what
			lets their keyboard shortcuts work no matter which tab is showing.
			Unselected panels are hidden in CSS. */}
			<Tabs forceRenderTabPanel selectedTabClassName="selected">
				<div className="route-toolbar-top">
					<BackButton />
					{/* A tablist may only hold tabs, so links sit beside it in the DOM and are
					placed among the tabs by `order`; the list itself is `display: contents`. */}
					<div className="route-toolbar-tabrow">
						<TabList className="route-toolbar-tablist">
							{tabEntries.map(([tabName, tabContent], order) =>
								isRouteToolbarLink(tabContent) ? null : (
									<Tab
										className="route-toolbar-tab"
										key={tabName}
										style={{order}}
									>
										{tabName}
									</Tab>
								)
							)}
						</TabList>
						{tabEntries.map(([tabName, tabContent], order) =>
							isRouteToolbarLink(tabContent) ? (
								<TabLink
									key={tabName}
									label={tabName}
									link={tabContent}
									order={order}
								/>
							) : null
						)}
					</div>
					{leadingControls && (
						<div className="route-toolbar-leading-controls">
							{leadingControls}
						</div>
					)}
					<div className="route-toolbar-pinned-controls">
						{pinnedControls}
						<IconButton
							icon={<IconHelp />}
							label={t('common.help')}
							onClick={() => window.open(helpUrl, '_blank')}
						/>
					</div>
				</div>
				<div className="route-toolbar-bottom">
					<div className="route-toolbar-panels">
						{tabEntries.map(([tabName, tabContent]) =>
							isRouteToolbarLink(tabContent) ? null : (
								<TabPanel key={tabName}>{tabContent}</TabPanel>
							)
						)}
					</div>
					{statusControls && (
						<div className="route-toolbar-status-controls">
							{statusControls}
						</div>
					)}
					{trailingControls && (
						<div className="route-toolbar-trailing-controls">
							{trailingControls}
						</div>
					)}
				</div>
			</Tabs>
		</div>
	);
};
