import {IconHelp} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {Tab, TabList, TabPanel, Tabs} from 'react-tabs';
import {IconButton} from '../control/icon-button';
import {BackButton} from './back-button';
import './route-toolbar.css';

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
	tabs: Record<string, React.ReactNode>;
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

	return (
		<div className="route-toolbar">
			{/* forceRenderTabPanel keeps every tab's buttons mounted, which is what
			lets their keyboard shortcuts work no matter which tab is showing.
			Unselected panels are hidden in CSS. */}
			<Tabs forceRenderTabPanel selectedTabClassName="selected">
				<div className="route-toolbar-top">
					<BackButton />
					<TabList className="route-toolbar-tablist">
						{Object.keys(tabs).map(tabName => (
							<Tab className="route-toolbar-tab" key={tabName}>
								{tabName}
							</Tab>
						))}
					</TabList>
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
						{Object.entries(tabs).map(([tabName, tabContent]) => (
							<TabPanel key={tabName}>{tabContent}</TabPanel>
						))}
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
