import {
	ASSET_DRAG_MIME,
	isAssetDrag,
	readAssetDragData,
	setAssetDragData
} from '../asset-drag';

/** jsdom has no DataTransfer. This is the whole of the interface the module uses. */
function fakeTransfer() {
	const data: Record<string, string> = {};

	return {
		dropEffect: 'none',
		effectAllowed: 'none',
		getData: (type: string) => data[type] ?? '',
		setData: (type: string, value: string) => {
			data[type] = value;
		},
		get types() {
			return Object.keys(data);
		}
	} as unknown as DataTransfer;
}

describe('asset drag payloads', () => {
	it('round trips', () => {
		const transfer = fakeTransfer();

		setAssetDragData(transfer, {ref: 'tavern/night', target: 'bg'});

		expect(readAssetDragData(transfer)).toEqual({
			ref: 'tavern/night',
			target: 'bg'
		});
	});

	it('also offers the scene fragment as plain text', () => {
		const transfer = fakeTransfer();

		setAssetDragData(
			transfer,
			{ref: 'tavern/night', target: 'bg'},
			'bg: tavern/night'
		);

		expect(transfer.getData('text/plain')).toBe('bg: tavern/night');
	});

	it('recognizes its own drag from the type list alone', () => {
		// During dragover the browser refuses `getData`, so this is all there is to go on.
		expect(isAssetDrag([ASSET_DRAG_MIME, 'text/plain'])).toBe(true);
		expect(isAssetDrag(['Files'])).toBe(false);
		expect(isAssetDrag(undefined)).toBe(false);
	});

	it('rejects a payload with no ref rather than writing an empty entity', () => {
		const transfer = fakeTransfer();

		transfer.setData(ASSET_DRAG_MIME, JSON.stringify({target: 'cast'}));
		expect(readAssetDragData(transfer)).toBeUndefined();
	});

	it('rejects a payload with an unknown target', () => {
		const transfer = fakeTransfer();

		transfer.setData(
			ASSET_DRAG_MIME,
			JSON.stringify({ref: 'mira', target: 'fx'})
		);
		expect(readAssetDragData(transfer)).toBeUndefined();
	});

	it('survives mangled JSON', () => {
		const transfer = fakeTransfer();

		transfer.setData(ASSET_DRAG_MIME, '{not json');
		expect(readAssetDragData(transfer)).toBeUndefined();
	});

	it('is undefined when there is no transfer at all', () => {
		expect(readAssetDragData(null)).toBeUndefined();
	});
});
