import {storyCreatedFromRevisions} from '../story-created';
import type {RevisionEntry} from '../server.types';

function revision(rev: number, at: string): RevisionEntry {
	return {at, bytes: 1, client: 'mira', hash: 'h', passages: 1, rev};
}

describe('storyCreatedFromRevisions', () => {
	const entry = {rev: 9, updatedAt: '2026-09-09T00:00:00.000Z'};

	it('is exact when rev 1 is still kept', () => {
		expect(
			storyCreatedFromRevisions(
				{
					current: 9,
					revisions: [
						revision(8, '2026-09-08T00:00:00.000Z'),
						revision(1, '2026-08-01T00:00:00.000Z')
					]
				},
				entry
			)
		).toEqual({at: '2026-08-01T00:00:00.000Z', exact: true});
	});

	it('is an upper bound when the oldest kept rev is later than 1', () => {
		expect(
			storyCreatedFromRevisions(
				{
					current: 9,
					revisions: [
						revision(4, '2026-08-04T00:00:00.000Z'),
						revision(6, '2026-08-06T00:00:00.000Z')
					]
				},
				entry
			)
		).toEqual({at: '2026-08-04T00:00:00.000Z', exact: false});
	});

	it('uses the current version when there are no snapshots', () => {
		expect(
			storyCreatedFromRevisions(
				{current: 1, revisions: []},
				{rev: 1, updatedAt: '2026-08-01T00:00:00.000Z'}
			)
		).toEqual({at: '2026-08-01T00:00:00.000Z', exact: true});
		expect(
			storyCreatedFromRevisions({current: 9, revisions: []}, entry)
		).toEqual({at: entry.updatedAt, exact: false});
	});

	it('knows nothing with no snapshots and no index entry', () => {
		expect(
			storyCreatedFromRevisions({current: 1, revisions: []})
		).toBeUndefined();
	});
});
