import {
	clientsInStory,
	emptyPresence,
	isStolen,
	lockedPassages,
	lockFor,
	passageLock,
	presenceDisconnected,
	presenceNames,
	presenceReducer,
	type PresenceState
} from '../presence';
import type {PresenceClient} from '../server.types';
import {testPresenceClient} from '../test-fixtures';

function stateWith(clients: PresenceClient[]) {
	return presenceReducer(emptyPresence('me'), {clients, t: 'presence'});
}

const me = testPresenceClient({
	id: 'me',
	name: 'mira',
	passage: 'harbour',
	since: '2026-08-21T10:00:00.000Z',
	story: 'story-1'
});

const them = testPresenceClient({
	id: 'them',
	name: 'jules',
	passage: 'harbour',
	since: '2026-08-21T10:05:00.000Z',
	story: 'story-1'
});

describe('presenceReducer', () => {
	it('takes the client list from welcome and presence alike', () => {
		const afterWelcome = presenceReducer(emptyPresence('me'), {
			clients: [me],
			t: 'welcome'
		});

		expect(afterWelcome.clients).toEqual([me]);
		expect(
			presenceReducer(afterWelcome, {clients: [me, them], t: 'presence'})
				.clients
		).toEqual([me, them]);
	});

	it('ignores messages that are not about people', () => {
		const state = stateWith([me, them]);

		expect(
			presenceReducer(state, {id: 'x', by: 'jules', rev: 2, t: 'story'})
		).toBe(state);
		expect(presenceReducer(state, {t: 'pong'})).toBe(state);
	});

	it('forgets everything but our own id when the socket drops', () => {
		const state = presenceReducer(stateWith([me, them]), {
			by: 'jules',
			passage: 'harbour',
			story: 'story-1',
			t: 'stolen'
		});
		const dropped = presenceDisconnected(state);

		expect(dropped.clients).toEqual([]);
		expect(dropped.stolen).toEqual([]);
		expect(dropped.selfId).toBe('me');
	});
});

describe('clientsInStory', () => {
	it('never includes ourselves', () => {
		expect(clientsInStory(stateWith([me, them]), 'story-1')).toEqual([them]);
	});

	it('leaves out people in other stories', () => {
		const elsewhere = testPresenceClient({id: 'other', story: 'story-2'});

		expect(clientsInStory(stateWith([them, elsewhere]), 'story-1')).toEqual([
			them
		]);
	});
});

describe('lockFor', () => {
	it('is undefined when nobody else is in the passage', () => {
		expect(lockFor(stateWith([me]), 'story-1', 'harbour')).toBeUndefined();
	});

	it('never reports ourselves, even in two tabs of one name', () => {
		const otherTab = testPresenceClient({
			id: 'me',
			name: 'mira',
			passage: 'harbour',
			story: 'story-1'
		});

		expect(
			lockFor(stateWith([me, otherTab]), 'story-1', 'harbour')
		).toBeUndefined();
	});

	it('names the other client to the late arrival', () => {
		const earlyThem = {...them, since: '2026-08-21T09:00:00.000Z'};

		expect(lockFor(stateWith([earlyThem, me]), 'story-1', 'harbour')).toEqual(
			earlyThem
		);
	});

	it('does not lock out whoever was there first', () => {
		// `me` arrived at 10:00, `them` at 10:05.
		expect(
			lockFor(stateWith([me, them]), 'story-1', 'harbour')
		).toBeUndefined();
	});

	it('clears when the other client blurs the passage', () => {
		const earlyThem = {...them, since: '2026-08-21T09:00:00.000Z'};
		const state = stateWith([earlyThem, me]);

		expect(lockFor(state, 'story-1', 'harbour')).toBeDefined();

		const afterBlur = presenceReducer(state, {
			clients: [{...earlyThem, passage: null}, me],
			t: 'presence'
		});

		expect(lockFor(afterBlur, 'story-1', 'harbour')).toBeUndefined();
	});
});

describe('passageLock', () => {
	function stolen(state: PresenceState) {
		return presenceReducer(state, {
			by: 'mira',
			passage: 'harbour',
			story: 'story-1',
			t: 'stolen'
		});
	}

	it('reports a plain lock as not shared', () => {
		const earlyThem = {...them, since: '2026-08-21T09:00:00.000Z'};

		expect(
			passageLock(stateWith([earlyThem, me]), 'story-1', 'harbour')
		).toEqual({by: earlyThem, shared: false});
	});

	it('marks the passage shared for both sides after a steal', () => {
		const earlyThem = {...them, since: '2026-08-21T09:00:00.000Z'};
		// The late arrival, who was read-only a moment ago.
		const late = stolen(stateWith([earlyThem, me]));
		// And the one who was there first, who never had a banner at all.
		const first = stolen(stateWith([me, them]));

		expect(isStolen(late, 'story-1', 'harbour')).toBe(true);
		expect(passageLock(late, 'story-1', 'harbour')).toEqual({
			by: earlyThem,
			shared: true
		});
		expect(passageLock(first, 'story-1', 'harbour')).toEqual({
			by: them,
			shared: true
		});
	});

	it('retires the steal once the other editor leaves', () => {
		const state = stolen(stateWith([me, them]));
		const alone = presenceReducer(state, {clients: [me], t: 'presence'});

		expect(isStolen(alone, 'story-1', 'harbour')).toBe(false);
		expect(passageLock(alone, 'story-1', 'harbour')).toBeUndefined();
	});

	it('does not invent a banner when only we are in the passage', () => {
		const state = stolen(stateWith([me]));

		expect(passageLock(state, 'story-1', 'harbour')).toBeUndefined();
	});
});

describe('lockedPassages', () => {
	it('maps passage ids to names, skipping people in no passage', () => {
		const idle = testPresenceClient({
			id: 'idle',
			name: 'ada',
			passage: null,
			story: 'story-1'
		});
		const elsewhere = testPresenceClient({
			id: 'far',
			name: 'kai',
			passage: 'lamp',
			story: 'story-1'
		});

		expect(
			lockedPassages(stateWith([me, them, idle, elsewhere]), 'story-1')
		).toEqual({harbour: 'jules', lamp: 'kai'});
	});
});

describe('presenceNames', () => {
	it('deduplicates and sorts', () => {
		expect(
			presenceNames([
				testPresenceClient({id: '1', name: 'bob'}),
				testPresenceClient({id: '2', name: 'alice'}),
				testPresenceClient({id: '3', name: 'bob'})
			])
		).toEqual(['alice', 'bob']);
	});
});
