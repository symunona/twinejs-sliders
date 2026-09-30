import {act, fireEvent, render, screen} from '@testing-library/react';
import {renderHook} from '@testing-library/react-hooks';
import * as React from 'react';
import type {AssetResolver} from '@sliders/scene-types';
import {FakeStateProvider} from '../../../../test-util';
import {GRADE_ORIGIN} from '../grade-write';
import {StageSelectionControls} from '../stage-selection-controls';
import {applyGradeDraft, useGradeEdit} from '../use-grade-edit';
import {parseSceneText} from '../use-scene-parse';

const passage = [
	'[scene]',
	'cast:',
	'  hero: {at: 0.3, grade: {warmth: 30}}',
	'  mira: {at: -0.3}'
].join('\n');
const parse = parseSceneText(passage);

describe('applyGradeDraft', () => {
	it('paints the draft over one entity and leaves the stage alone otherwise', () => {
		const stage = parse.states[0];

		expect(applyGradeDraft(stage, undefined)).toBe(stage);
		expect(
			applyGradeDraft(stage, {grade: {hue: 5}, id: 'hero'}).entities.hero.grade
		).toEqual({hue: 5});
		expect(applyGradeDraft(stage, {grade: {hue: 5}, id: 'nobody'})).toBe(stage);
	});
});

describe('useGradeEdit', () => {
	function setup() {
		const commit = jest.fn();
		const hook = renderHook(() =>
			useGradeEdit({
				beat: 0,
				commit,
				parsedStage: parse.states[0],
				scene: parse.result!.scene,
				states: parse.states
			})
		);

		return {commit, hook};
	}

	it('paints a move and writes nothing until release', () => {
		const {commit, hook} = setup();

		act(() => hook.result.current.change('hero', {warmth: 60}));
		expect(hook.result.current.draft).toEqual({grade: {warmth: 60}, id: 'hero'});
		expect(commit).not.toHaveBeenCalled();

		act(() => hook.result.current.commit());
		expect(commit).toHaveBeenCalledWith(
			[{id: 'hero', key: 'grade', kind: 'cast', ref: 'hero', value: {warmth: 60}}],
			GRADE_ORIGIN
		);
	});

	it('holds a second release until the first write has been parsed', () => {
		const {commit, hook} = setup();

		act(() => hook.result.current.change('hero', {warmth: 60}));
		act(() => hook.result.current.commit());
		act(() => hook.result.current.change('hero', {warmth: 70}));
		act(() => hook.result.current.commit());
		expect(commit).toHaveBeenCalledTimes(1);
	});

	it('writes what is left when the popover closes', () => {
		const {commit, hook} = setup();

		act(() => hook.result.current.openChange(true));
		act(() => hook.result.current.change('hero', undefined));
		act(() => hook.result.current.openChange(false));
		expect(commit).toHaveBeenCalledWith(
			[{id: 'hero', key: 'grade', kind: 'cast', ref: 'hero', value: undefined}],
			GRADE_ORIGIN
		);
	});

	it('drops a draft that matches the parse without writing', () => {
		const {commit, hook} = setup();

		act(() => hook.result.current.change('hero', {warmth: 30}));
		expect(hook.result.current.draft).toBeUndefined();
		act(() => hook.result.current.commit());
		expect(commit).not.toHaveBeenCalled();
	});
});

describe('the Grade button', () => {
	const assets = {
		character: async () => undefined,
		meta: async () => undefined,
		url: async () => undefined
	} as unknown as AssetResolver;

	function renderRow(ids: string[]) {
		const handlers = {
			onGrade: jest.fn(),
			onGradeCommit: jest.fn(),
			onGradeOpenChange: jest.fn()
		};

		render(
			<FakeStateProvider>
				<StageSelectionControls
					assets={assets}
					editable
					entities={ids.map(id => parse.states[0].entities[id])}
					onDelete={jest.fn()}
					onFlip={jest.fn()}
					onPose={jest.fn()}
					onPreviewPose={jest.fn()}
					onStepZ={jest.fn()}
					{...handlers}
				/>
			</FakeStateProvider>
		);

		return handlers;
	}

	it('is there for one sprite, lit when it is graded, and opens the popover', () => {
		const {onGradeOpenChange} = renderRow(['hero']);
		const button = screen.getByRole('button', {
			name: 'dialogs.passageEdit.scenePreview.grade.button'
		});

		expect(button.getAttribute('aria-pressed')).toBe('true');
		fireEvent.click(button);
		expect(onGradeOpenChange).toHaveBeenLastCalledWith(true);
		expect(document.querySelector('.scene-grade-popover')).not.toBeNull();
	});

	it('is not there for two', () => {
		renderRow(['hero', 'mira']);
		expect(
			screen.queryByRole('button', {
				name: 'dialogs.passageEdit.scenePreview.grade.button'
			})
		).toBeNull();
	});
});
