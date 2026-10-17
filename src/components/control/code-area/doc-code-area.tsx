import CodeMirror from 'codemirror';
import classnames from 'classnames';
import * as React from 'react';
import 'codemirror/addon/display/placeholder';
import 'codemirror/addon/hint/show-hint';
import 'codemirror/addon/hint/show-hint.css';
import 'codemirror/lib/codemirror.css';
import './code-area.css';
import './codemirror-theme.css';
import {initPrefixTriggerGlobally} from '../../../codemirror/prefix-trigger';
import {
	minimalEdit,
	PassageDoc,
	usePassageDocRegistry,
	usePassageDocText
} from '../../../store/passage-docs';

initPrefixTriggerGlobally();

export interface DocCodeAreaProps {
	fontFamily?: string;
	fontScale?: number;
	/** Set on the input itself, so the label points at it. */
	id: string;
	label: string;
	labelHidden?: boolean;
	handle: PassageDoc;
	/** Applied on create and diffed after. `value` is the Doc's, never an option. */
	options: CodeMirror.EditorConfiguration;
	/** The view, once it exists; undefined as it goes. */
	onEditor?: (editor: CodeMirror.Editor | undefined) => void;
	/** Off: a plain textarea bound to the same Doc (the `useCodeMirror` pref). */
	useCodeMirror?: boolean;
}

/**
 * A CodeMirror 5 VIEW onto a registry Doc.
 *
 * Not react-codemirror2: its `Controlled` owns the value and would fight `swapDoc`. Here the
 * Doc is the model and outlives this component -- unmounting swaps a throwaway Doc in, so
 * the shared one leaves cleanly with its history, selection and marks intact for the next
 * view or for the scene preview writing to it headless.
 */
export const DocCodeArea: React.FC<DocCodeAreaProps> = props => {
	const {
		fontFamily,
		fontScale,
		handle,
		id,
		label,
		labelHidden,
		onEditor,
		options,
		useCodeMirror
	} = props;
	const registry = usePassageDocRegistry();
	const host = React.useRef<HTMLDivElement>(null);
	const [editor, setEditor] = React.useState<CodeMirror.Editor>();
	const latest = React.useRef({onEditor, options});
	const applied = React.useRef<CodeMirror.EditorConfiguration>({});
	const style: React.CSSProperties = {};

	latest.current = {onEditor, options};

	if (fontFamily) {
		style.fontFamily = fontFamily.includes(' ')
			? `"${fontFamily}"`
			: fontFamily;
	}

	if (fontScale) {
		style.fontSize = `${fontScale * 100}%`;
	}

	React.useLayoutEffect(() => {
		if (!useCodeMirror || !host.current) {
			return;
		}

		const initial = latest.current.options;
		const view = CodeMirror(host.current, {...initial, value: ''});
		const doc = registry.attachView(handle, view);

		view.swapDoc(doc);
		// `swapDoc` takes the Doc's mode over the editor's. The format's mode wins.
		view.setOption('mode', initial.mode);
		applied.current = initial;
		view.getInputField().setAttribute('id', id);

		// Leaving the text is the author pausing: commit now rather than in a second.
		const flush = () => handle.flush();

		view.on('blur', flush);
		setEditor(view);
		latest.current.onEditor?.(view);

		return () => {
			view.off('blur', flush);
			latest.current.onEditor?.(undefined);
			view.swapDoc(new CodeMirror.Doc(''));
			registry.detachView(handle, view, doc);
			view.getWrapperElement().remove();
			setEditor(undefined);
		};
		// `id` is set once; the input does not change identity.
		// eslint-disable-next-line
	}, [handle, registry, useCodeMirror]);

	React.useEffect(() => {
		if (!editor) {
			return;
		}

		const previous = applied.current;

		for (const name of Object.keys(options) as (keyof typeof options)[]) {
			if (previous[name] !== options[name]) {
				editor.setOption(name, options[name]);
			}
		}

		applied.current = options;
	}, [editor, options]);

	// Font changes resize every line.
	React.useEffect(() => editor?.refresh(), [editor, fontFamily, fontScale]);

	return (
		<div className="code-area" style={style}>
			<label
				htmlFor={id}
				className={classnames('label', {'screen-reader-only': labelHidden})}
			>
				{label}
			</label>
			{useCodeMirror ? (
				<div className="react-codemirror2" ref={host} />
			) : (
				<DocTextarea
					handle={handle}
					id={id}
					placeholder={options.placeholder as string | undefined}
					readOnly={!!options.readOnly}
					style={style}
				/>
			)}
		</div>
	);
};

/** The `useCodeMirror: false` pref: a textarea writing minimal edits into the Doc. */
const DocTextarea: React.FC<{
	handle: PassageDoc;
	id: string;
	placeholder?: string;
	readOnly: boolean;
	style: React.CSSProperties;
}> = ({handle, id, placeholder, readOnly, style}) => {
	const docText = usePassageDocText(handle) ?? '';
	// Local, because a headless Doc reports its change a tick late: bound straight to the
	// Doc, React would put the old value back under the caret and throw it to the end.
	const [text, setText] = React.useState(docText);

	React.useEffect(() => setText(docText), [docText]);

	function handleChange(next: string) {
		const {doc} = handle;

		setText(next);

		const edit = minimalEdit(doc.getValue(), next);

		if (edit) {
			doc.replaceRange(
				edit.text,
				doc.posFromIndex(edit.start),
				doc.posFromIndex(edit.end),
				'+input'
			);
		}
	}

	return (
		<textarea
			className="visible"
			id={id}
			onBlur={() => handle.flush()}
			onChange={event => handleChange(event.target.value)}
			placeholder={placeholder}
			readOnly={readOnly}
			style={style}
			value={text}
		/>
	);
};
