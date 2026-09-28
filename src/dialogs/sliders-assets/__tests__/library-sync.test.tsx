import {fireEvent, render, screen, within} from '@testing-library/react';
import * as React from 'react';
import {AssetRecord} from '@sliders/asset-library';
import {png} from '../../../../packages/asset-library/src/testing/fixtures';
import {
	byName,
	shaOf,
	team,
	upload
} from '../../../../packages/asset-library/src/testing/scenario';
import {ConflictCard, ConflictPanel} from '../library/conflict-panel';
import {collectionSync} from '../library/library-model';
import {chipState, SyncChip} from '../library/sync-chip';

/**
 * Sync UI over a REAL engine: the conflict panel's resolve paths and the chip states.
 * Conflicts are made the way people make them: one browser offline, both edit.
 */

jest.mock('react-i18next', () => {
	const t = (key: string) => key;

	return {useTranslation: () => ({t})};
});

beforeAll(() => {
	if (typeof globalThis.TextEncoder === 'undefined') {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const util = require('util');

		Object.assign(globalThis, {
			TextDecoder: util.TextDecoder,
			TextEncoder: util.TextEncoder
		});
	}

	if (!globalThis.crypto?.subtle) {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const {webcrypto} = require('crypto');

		Object.defineProperty(globalThis, 'crypto', {
			configurable: true,
			value: webcrypto
		});
	}
});

/** ana and bo both change `night` while bo is offline; bo comes back → conflict. */
async function conflicted(
	boEdit: (night: AssetRecord, t: Awaited<ReturnType<typeof team>>) => Promise<void>,
	anaEdit: (night: AssetRecord, t: Awaited<ReturnType<typeof team>>) => Promise<void>
) {
	const t = await team();
	const night = await upload(t.ana, t.tavern.id, 'night', 'night', {kind: 'bg'});

	await t.world.settle();
	t.bo.offline();
	await boEdit(night, t);
	await anaEdit(night, t);
	await t.world.settle();
	await t.bo.online();
	await t.world.settle();

	return {...t, night};
}

function renderCard(t: Awaited<ReturnType<typeof conflicted>>) {
	const [conflict] = t.bo.engine.conflicts();

	return render(
		<ConflictCard
			collectionName={() => 'tavern-set'}
			conflict={conflict}
			engine={t.bo.engine}
		/>
	);
}

describe('conflict panel', () => {
	it('two repaints: keep both saves mine as name-2, theirs stays on the name', async () => {
		const t = await conflicted(
			async (night, {bo}) => {
				await bo.engine.replaceBlob(night.id, png('blue'), 'image/png');
			},
			async (night, {ana}) => {
				await ana.engine.replaceBlob(night.id, png('green'), 'image/png');
			}
		);

		expect(t.bo.engine.conflicts()[0].fields).toContain('blob');
		renderCard(t);

		// Base / mine / theirs thumbnails, one row per side.
		expect(document.querySelectorAll('.library-blob-preview')).toHaveLength(3);
		fireEvent.click(
			screen.getByRole('radio', {name: /dialogs.library.conflict.keepBoth/})
		);
		fireEvent.click(
			screen.getByRole('button', {name: 'dialogs.library.conflict.resolve'})
		);
		expect(t.bo.engine.conflicts()).toEqual([]);
		await t.world.settle();

		for (const browser of [t.ana, t.bo]) {
			expect(byName(browser, t.tavern.id, 'night')!.blob).toBe(
				await shaOf('green')
			);
			expect(byName(browser, t.tavern.id, 'night-2')!.blob).toBe(
				await shaOf('blue')
			);
		}
	});

	it('per-field picks: their name, my pixels; untouched fields shown auto-merged', async () => {
		const t = await conflicted(
			async (night, {bo}) => {
				await bo.engine.replaceBlob(night.id, png('blue'), 'image/png');
				bo.engine.rename(night.id, 'late');
			},
			async (night, {ana}) => {
				await ana.engine.replaceBlob(night.id, png('green'), 'image/png');
				ana.engine.rename(night.id, 'dusk');
				ana.engine.updateAsset(night.id, {tags: ['wet']});
			}
		);

		renderCard(t);

		const nameRow = document.querySelector<HTMLElement>('tr[data-field="name"]')!;
		const tagsRow = document.querySelector<HTMLElement>('tr[data-field="tags"]')!;

		expect(tagsRow).toHaveClass('auto-merged');
		expect(tagsRow).toHaveTextContent('dialogs.library.conflict.autoMerged');
		// Default pick is mine; take theirs for the name only.
		fireEvent.click(within(nameRow).getByRole('radio', {name: 'ana'}));
		fireEvent.click(
			screen.getByRole('button', {name: 'dialogs.library.conflict.resolve'})
		);
		await t.world.settle();

		const night = t.ana.engine.get<'asset'>(t.night.id, 'asset')!;

		expect(night.name).toBe('dusk');
		expect(night.blob).toBe(await shaOf('blue'));
		// The hidden picture fields came with the pixels.
		expect(night.pixelHash).toBe(
			t.bo.engine.get<'asset'>(t.night.id, 'asset')!.pixelHash
		);
		expect(night.tags).toEqual(['wet']);
	});

	it('theirs on every field drops my edit', async () => {
		const t = await conflicted(
			async (night, {bo}) => {
				bo.engine.rename(night.id, 'late');
			},
			async (night, {ana}) => {
				ana.engine.rename(night.id, 'dusk');
			}
		);

		renderCard(t);
		fireEvent.click(screen.getByRole('radio', {name: 'ana'}));
		fireEvent.click(
			screen.getByRole('button', {name: 'dialogs.library.conflict.resolve'})
		);
		expect(t.bo.engine.state(t.night.id, 'asset')!.dirty).toBe(false);
		expect(t.bo.engine.get<'asset'>(t.night.id, 'asset')!.name).toBe('dusk');
	});

	it('the panel lists only the shown collection’s conflicts', async () => {
		const t = await conflicted(
			async (night, {bo}) => {
				bo.engine.rename(night.id, 'late');
			},
			async (night, {ana}) => {
				ana.engine.rename(night.id, 'dusk');
			}
		);
		const other = t.bo.engine.createCollection({name: 'other'});

		const {rerender} = render(
			<ConflictPanel
				collection={other.id}
				collectionName={() => ''}
				engine={t.bo.engine}
				version={0}
			/>
		);

		expect(screen.getByText('dialogs.library.conflict.none')).toBeInTheDocument();
		rerender(
			<ConflictPanel
				collection={t.tavern.id}
				collectionName={() => 'tavern-set'}
				engine={t.bo.engine}
				version={1}
			/>
		);
		expect(document.querySelectorAll('.library-conflict')).toHaveLength(1);
	});
});

describe('sync chips', () => {
	it('synced, pending while offline, conflict — per collection', async () => {
		const t = await team();
		const night = await upload(t.ana, t.tavern.id, 'night', 'night');
		const other = t.bo.engine.createCollection({name: 'other'});

		await t.world.settle();

		const chip = (collection?: string) =>
			collectionSync(t.bo.engine, collection, {
				...t.bo.engine.status(),
				online: true
			});

		expect(chipState(chip(t.tavern.id))).toBe('synced');

		t.bo.offline();
		t.bo.engine.rename(night.id, 'late');
		await t.bo.engine.sync().catch(() => undefined);
		expect(chip(t.tavern.id)).toMatchObject({offline: true, pending: 1});
		expect(chipState(chip(t.tavern.id))).toBe('offline');
		// The other collection has nothing waiting.
		expect(chip(other.id).pending).toBe(0);

		t.ana.engine.rename(night.id, 'dusk');
		await t.world.settle();
		await t.bo.online();
		await t.world.settle();
		expect(chip(t.tavern.id)).toMatchObject({conflicts: 1, offline: false});
		expect(chipState(chip(t.tavern.id))).toBe('conflicts');
		expect(chip(other.id).conflicts).toBe(0);
		// Aggregate: the whole library.
		expect(chip(undefined).conflicts).toBe(1);
	});

	it('renders each state; only a conflict chip is a button', () => {
		const onOpen = jest.fn();
		const base = {conflicts: 0, downloading: 0, offline: false, pending: 0};
		const {rerender} = render(<SyncChip onOpenConflicts={onOpen} sync={base} />);

		expect(screen.getByRole('status')).toHaveTextContent(
			'dialogs.library.chip.synced'
		);
		rerender(<SyncChip onOpenConflicts={onOpen} sync={{...base, pending: 3}} />);
		expect(screen.getByRole('status')).toHaveTextContent(
			'dialogs.library.chip.pending'
		);
		rerender(<SyncChip onOpenConflicts={onOpen} sync={{...base, downloading: 1}} />);
		expect(screen.getByRole('status')).toHaveAttribute('data-state', 'downloading');
		rerender(
			<SyncChip onOpenConflicts={onOpen} sync={{...base, offline: true, pending: 2}} />
		);
		expect(screen.getByRole('status')).toHaveTextContent(
			'dialogs.library.chip.offlinePending'
		);
		rerender(<SyncChip onOpenConflicts={onOpen} sync={{...base, conflicts: 2}} />);
		fireEvent.click(
			screen.getByRole('button', {name: 'dialogs.library.chip.conflicts'})
		);
		expect(onOpen).toHaveBeenCalled();
	});
});
