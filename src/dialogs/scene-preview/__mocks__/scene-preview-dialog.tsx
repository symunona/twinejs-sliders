import * as React from 'react';
import {ScenePreviewDialogProps} from '../scene-preview-dialog';

export const ScenePreviewDialog: React.FC<ScenePreviewDialogProps> & {
	stackToBottom?: boolean;
} = props => (
	<div
		data-testid="mock-scene-preview-dialog"
		data-maximized={String(props.maximized)}
		data-story-id={props.storyId}
	/>
);

ScenePreviewDialog.stackToBottom = true;
