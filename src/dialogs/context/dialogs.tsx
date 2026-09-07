import * as React from 'react';
import {useScrollbarSize} from 'react-scrollbar-size';
import {CSSTransition, TransitionGroup} from 'react-transition-group';
import {useDialogsContext} from '.';
import {Dialog} from '../dialogs.types';
import {usePrefsContext} from '../../store/prefs';
import './dialogs.css';

// TODO move this to separate module to avoid circular dep
const DialogTransition: React.FC = props => (
	<CSSTransition classNames="pop" timeout={200} {...props}>
		{props.children}
	</CSSTransition>
);

/**
 * Where a dialog sits in the column, whatever order it was opened in. A component opts into
 * the bottom by setting `stackToBottom` on itself--read off the component here rather than
 * imported by name, so this module goes on knowing nothing about any particular dialog.
 *
 * The scene preview is the only one so far: it is a picture of whatever passage is being
 * edited, so it belongs under the editor. Opened the other way round--preview first from a
 * passage selected on the map, then an editor--it would otherwise sit on top of the passage
 * it is previewing.
 */
function stackWeight(dialog: Dialog) {
	return (dialog.component as {stackToBottom?: boolean}).stackToBottom ? 1 : 0;
}

export const Dialogs: React.FC = () => {
	const {height, width} = useScrollbarSize();
	const {prefs} = usePrefsContext();
	const {dispatch, dialogs} = useDialogsContext();

	const hasUnmaximized = dialogs.some(dialog => !dialog.maximized);
	const containerStyle: React.CSSProperties = {
		paddingLeft: `calc(100% - (${prefs.dialogWidth}px + 2 * (var(--grid-size))))`,
		marginBottom: height,
		marginRight: width
	};
	const maximizedStyle: React.CSSProperties = {
		marginRight: hasUnmaximized
			? `calc(${prefs.dialogWidth}px + var(--grid-size))`
			: 0
	};

	return (
		<div className="dialogs" style={containerStyle}>
			<TransitionGroup component={null}>
				{dialogs
					.map((dialog, index) => ({dialog, index}))
					.sort(
						(a, b) =>
							stackWeight(a.dialog) - stackWeight(b.dialog) || a.index - b.index
					)
					.map(({dialog, index}) => {
						const managementProps = {
							collapsed: dialog.collapsed,
							highlighted: dialog.highlighted,
							maximized: dialog.maximized,
							onChangeCollapsed: (collapsed: boolean) =>
								dispatch({type: 'setDialogCollapsed', collapsed, index}),
							onChangeHighlighted: (highlighted: boolean) =>
								dispatch({type: 'setDialogHighlighted', highlighted, index}),
							onChangeMaximized: (maximized: boolean) =>
								dispatch({type: 'setDialogMaximized', maximized, index}),
							onChangeProps: (props: Record<string, any>) =>
								dispatch({type: 'setDialogProps', index, props}),
							onClose: () => dispatch({type: 'removeDialog', index})
						};

						return (
							<DialogTransition key={index}>
								{dialog.maximized ? (
									<div className="maximized" style={maximizedStyle}>
										<dialog.component {...dialog.props} {...managementProps} />
									</div>
								) : (
									<dialog.component {...dialog.props} {...managementProps} />
								)}
							</DialogTransition>
						);
					})}
			</TransitionGroup>
		</div>
	);
};
