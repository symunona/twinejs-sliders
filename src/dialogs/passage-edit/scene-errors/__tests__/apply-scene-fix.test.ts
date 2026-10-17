import CodeMirror from 'codemirror';
import type {SceneFix} from '@sliders/scene-types';
import {applySceneFix} from '../apply-scene-fix';

const fix: SceneFix = {
	col: 3,
	endCol: 6,
	label: "Change 'bgg' to 'bg'",
	line: 2,
	replaces: 'bgg',
	text: 'bg'
};

describe('applySceneFix', () => {
	it('replaces the span the parse saw, as one undo step', () => {
		const doc = new CodeMirror.Doc('[scene]\n  bgg: hall\n');

		expect(applySceneFix(doc, fix)).toBe(true);
		expect(doc.getValue()).toBe('[scene]\n  bg: hall\n');
		doc.undo();
		expect(doc.getValue()).toBe('[scene]\n  bgg: hall\n');
	});

	it('refuses once the author has typed over the span', () => {
		const doc = new CodeMirror.Doc('[scene]\n  bgx: hall\n');

		expect(applySceneFix(doc, fix)).toBe(false);
		expect(doc.getValue()).toBe('[scene]\n  bgx: hall\n');
	});
});
