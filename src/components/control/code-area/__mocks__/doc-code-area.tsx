import * as React from 'react';
import type {DocCodeAreaProps} from '../doc-code-area';

const actual = jest.requireActual('../doc-code-area');

/**
 * The real component in its textarea mode: still bound to the registry Doc, no CodeMirror
 * view (jsdom cannot lay one out, and the global codemirror mock is not a constructor).
 */
export const DocCodeArea: React.FC<DocCodeAreaProps> = props => (
	<actual.DocCodeArea {...props} useCodeMirror={false} />
);
