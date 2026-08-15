import * as React from 'react';
import {CodeAreaProps} from '../code-area';

export const CodeArea: React.FC<CodeAreaProps> = props => {
	function handleOnChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
		props.onChangeEditor?.({
			historySize: () => ({
				redo: 0,
				undo: 0
			}),
			mockCodeMirrorEditor: true
		} as any);
		props.onChangeText(e.target.value);
	}

	return (
		<div
			data-testid="mock-code-area"
			data-font-family={props.fontFamily}
			data-font-scale={props.fontScale}
			data-options={JSON.stringify(props.options)}
			data-use-code-mirror={props.useCodeMirror}
			// Lets a test write text the way the scene editor does — from a NATIVE
			// listener rather than a React synthetic event. React 16 does not batch those,
			// so state updates flush synchronously mid-handler, which is a materially
			// different code path from `fireEvent.change` and has had a real bug in it.
			ref={node => {
				if (node) {
					(node as any).mockWriteText = props.onChangeText;
				}
			}}
		>
			<label>
				{props.label}
				<textarea
					onBlur={props.onBlur}
					onChange={handleOnChange}
					value={props.value}
				/>
			</label>
		</div>
	);
};
