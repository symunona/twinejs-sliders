/**
 * `StringStream.lookAhead` exists in CodeMirror 5.42+ but is missing from the
 * `@types/codemirror` this repo pins. Chapbook's mode uses it to find out whether a
 * passage has a vars section at all.
 */
import 'codemirror';

declare module 'codemirror' {
	interface StringStream {
		lookAhead(n: number): string | undefined;
	}
}
