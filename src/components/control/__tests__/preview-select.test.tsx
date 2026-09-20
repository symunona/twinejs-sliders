import {fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {PreviewSelect, PreviewSelectProps} from '../preview-select';

/*
 * i18n is not initialised under jest, so `t()` returns its own key -- the search box is
 * found by the key, never by the English word. See `.claude/TRAPS.md`.
 */
const SEARCH_LABEL = 'components.previewSelect.search';

const OPTIONS = [
	{label: 'None', value: ''},
	{label: 'Comic', preview: <span data-testid="swatch-comic" />, value: 'comic'},
	{label: 'Shard', preview: <span data-testid="swatch-shard" />, value: 'shard'},
	{label: 'Bangers', value: 'bangers'}
];

function renderComponent(props?: Partial<PreviewSelectProps>) {
	return render(
		<PreviewSelect
			onChange={jest.fn()}
			options={OPTIONS}
			value=""
			{...props}
		>
			Style
		</PreviewSelect>
	);
}

function open() {
	fireEvent.click(screen.getByRole('button'));
}

describe('PreviewSelect', () => {
	it('shows the selected option label on the closed button', () => {
		renderComponent({value: 'shard'});
		expect(screen.getByRole('button')).toHaveTextContent('Shard');
	});

	it('shows the selected option preview on the closed button', () => {
		renderComponent({value: 'comic'});
		expect(screen.getByTestId('swatch-comic')).toBeInTheDocument();
	});

	it('renders no list until it is opened', () => {
		renderComponent();
		expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
		open();
		expect(screen.getByRole('listbox')).toBeInTheDocument();
	});

	it('renders every option with its preview once open', () => {
		renderComponent();
		open();
		expect(screen.getAllByRole('option')).toHaveLength(OPTIONS.length);
		expect(screen.getByTestId('swatch-shard')).toBeInTheDocument();
	});

	it('marks the chosen option selected for a screen reader', () => {
		renderComponent({value: 'shard'});
		open();
		expect(
			screen.getByRole('option', {selected: true})
		).toHaveTextContent('Shard');
	});

	/*
	 * Committed on pointerdown rather than click: the button loses focus the moment the
	 * pointer goes down, and a blur handler upstream can re-render the list out from under
	 * the click that would otherwise have followed.
	 */
	it('commits an option on pointer down', () => {
		const onChange = jest.fn();

		renderComponent({onChange});
		open();
		fireEvent.pointerDown(screen.getByRole('option', {name: /Shard/}));
		expect(onChange).toHaveBeenCalledWith('shard');
		expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
	});

	it('does not fire onChange for the option already chosen', () => {
		const onChange = jest.fn();

		renderComponent({onChange, value: 'shard'});
		open();
		fireEvent.pointerDown(screen.getByRole('option', {name: /Shard/}));
		expect(onChange).not.toHaveBeenCalled();
	});

	it('closes on a press outside without committing', () => {
		const onChange = jest.fn();

		renderComponent({onChange});
		open();
		fireEvent.pointerDown(document.body);
		expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
		expect(onChange).not.toHaveBeenCalled();
	});

	describe('keyboard', () => {
		it('opens on ArrowDown', () => {
			renderComponent();
			fireEvent.keyDown(screen.getByRole('button'), {key: 'ArrowDown'});
			expect(screen.getByRole('listbox')).toBeInTheDocument();
		});

		it('walks the highlight and commits it with Enter', () => {
			const onChange = jest.fn();

			renderComponent({onChange});

			const button = screen.getByRole('button');

			fireEvent.keyDown(button, {key: 'ArrowDown'});
			fireEvent.keyDown(button, {key: 'ArrowDown'});
			fireEvent.keyDown(button, {key: 'Enter'});
			expect(onChange).toHaveBeenCalledWith('comic');
		});

		// Opening lands the highlight on what is already chosen, so Enter is a no-op and
		// the arrows start from where the author is, not from the top of the list.
		it('starts the highlight on the chosen option', () => {
			const onChange = jest.fn();

			renderComponent({onChange, value: 'shard'});

			const button = screen.getByRole('button');

			fireEvent.keyDown(button, {key: 'ArrowDown'});
			fireEvent.keyDown(button, {key: 'ArrowDown'});
			fireEvent.keyDown(button, {key: 'Enter'});
			expect(onChange).toHaveBeenCalledWith('bangers');
		});

		it('closes on Escape without committing', () => {
			const onChange = jest.fn();

			renderComponent({onChange});
			open();
			fireEvent.keyDown(screen.getByRole('button'), {key: 'Escape'});
			expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
			expect(onChange).not.toHaveBeenCalled();
		});

		/*
		 * The dialog this control sits in closes on Escape too. One press used to shut the
		 * dropdown and the dialog behind it, losing the author's place.
		 */
		it('keeps Escape from reaching the dialog behind it', () => {
			const onKeyDown = jest.fn();

			render(
				<div onKeyDown={onKeyDown}>
					<PreviewSelect onChange={jest.fn()} options={OPTIONS} value="">
						Style
					</PreviewSelect>
				</div>
			);
			open();
			fireEvent.keyDown(screen.getByRole('button'), {key: 'Escape'});
			expect(onKeyDown).not.toHaveBeenCalled();
		});

		// Closed, it is an ordinary control and the dialog's own Escape must still work.
		it('lets Escape through when it is closed', () => {
			const onKeyDown = jest.fn();

			render(
				<div onKeyDown={onKeyDown}>
					<PreviewSelect onChange={jest.fn()} options={OPTIONS} value="">
						Style
					</PreviewSelect>
				</div>
			);
			fireEvent.keyDown(screen.getByRole('button'), {key: 'Escape'});
			expect(onKeyDown).toHaveBeenCalled();
		});

		it('jumps to the ends with Home and End', () => {
			const onChange = jest.fn();

			renderComponent({onChange});
			open();
			fireEvent.keyDown(screen.getByRole('button'), {key: 'End'});
			fireEvent.keyDown(screen.getByRole('button'), {key: 'Enter'});
			expect(onChange).toHaveBeenCalledWith('bangers');
		});
	});

	describe('searchable', () => {
		it('has no filter box unless asked for one', () => {
			renderComponent();
			open();
			expect(screen.queryByLabelText(SEARCH_LABEL)).not.toBeInTheDocument();
		});

		it('narrows the list to what matches, ignoring case', () => {
			renderComponent({searchable: true});
			open();
			fireEvent.change(screen.getByLabelText(SEARCH_LABEL), {
				target: {value: 'sha'}
			});
			expect(screen.getAllByRole('option')).toHaveLength(1);
			expect(screen.getByRole('option')).toHaveTextContent('Shard');
		});

		it('says so when nothing matches', () => {
			renderComponent({searchable: true});
			open();
			fireEvent.change(screen.getByLabelText(SEARCH_LABEL), {
				target: {value: 'zzz'}
			});
			expect(screen.queryAllByRole('option')).toHaveLength(0);
			expect(
				screen.getByText('components.previewSelect.noMatches')
			).toBeInTheDocument();
		});

		it('commits the first match on Enter', () => {
			const onChange = jest.fn();

			renderComponent({onChange, searchable: true});
			open();

			const search = screen.getByLabelText(SEARCH_LABEL);

			fireEvent.change(search, {target: {value: 'ban'}});
			fireEvent.keyDown(search, {key: 'Enter'});
			expect(onChange).toHaveBeenCalledWith('bangers');
		});

		// Space is a character in the filter box, so it must not double as commit there.
		it('leaves Space to the filter box', () => {
			const onChange = jest.fn();

			renderComponent({onChange, searchable: true});
			open();
			fireEvent.keyDown(screen.getByLabelText(SEARCH_LABEL), {key: ' '});
			expect(onChange).not.toHaveBeenCalled();
			expect(screen.getByRole('listbox')).toBeInTheDocument();
		});

		it('forgets the filter between openings', () => {
			renderComponent({searchable: true});
			open();
			fireEvent.change(screen.getByLabelText(SEARCH_LABEL), {
				target: {value: 'sha'}
			});
			fireEvent.keyDown(screen.getByRole('button'), {key: 'Escape'});
			open();
			expect(screen.getAllByRole('option')).toHaveLength(OPTIONS.length);
		});
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});

	/*
	 * `region` is off for this one. The list is portalled to the body, so in a test that
	 * renders nothing else it is page content outside any landmark — which is a property of
	 * the harness, not of the control: in the app it hangs off a dialog that has its own.
	 * Everything the control IS responsible for (listbox, options, selected state, the
	 * labelling on both) is still asserted.
	 */
	it('is accessible when open', async () => {
		const {baseElement} = renderComponent();

		open();
		expect(
			await axe(baseElement, {rules: {region: {enabled: false}}})
		).toHaveNoViolations();
	});
});
