import {
	COMMIT_DELAY_MS,
	minimalEdit,
	PassageDocRegistry,
	STORE_ORIGIN
} from '../passage-doc-registry';

// The global mock (src/__mocks__/codemirror.ts) has no Doc. These tests are about the Doc.
jest.unmock('codemirror');

function setup(initial: Record<string, string> = {p1: 'hello\nworld'}) {
	const store: Record<string, string | undefined> = {...initial};
	const deps = {
		claim: jest.fn(),
		commit: jest.fn((_story: string, passage: string, text: string) => {
			store[passage] = text;
		}),
		storeText: jest.fn((_story: string, passage: string) => store[passage]),
		unclaim: jest.fn()
	};
	const registry = new PassageDocRegistry(deps);

	return {deps, registry, store};
}

/** Headless Doc events land on a zero timeout. */
function settle() {
	jest.advanceTimersByTime(0);
}

describe('PassageDocRegistry', () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => {
		// NOT clearAllTimers alone: CodeMirror queues headless Doc events behind ONE
		// module-level timeout, and a cleared one leaves the queue set forever -- every
		// later test's events then never fire.
		jest.runOnlyPendingTimers();
		jest.clearAllTimers();
		jest.useRealTimers();
	});

	it('creates a Doc holding the store text', () => {
		const {registry} = setup();
		const handle = registry.acquire('s', 'p1');

		expect(handle.doc.getValue()).toBe('hello\nworld');
		expect(handle.view()).toBeUndefined();
	});

	it('refcounts: one Doc per passage, dropped at zero', () => {
		const {registry} = setup();
		const a = registry.acquire('s', 'p1');
		const b = registry.acquire('s', 'p1');

		expect(b).toBe(a);
		registry.release(a);
		expect(registry.size()).toBe(1);
		registry.release(b);
		expect(registry.size()).toBe(0);
		expect(registry.acquire('s', 'p1')).not.toBe(a);
	});

	it('commits a local write after the debounce, not before', () => {
		const {deps, registry} = setup();
		const {doc} = registry.acquire('s', 'p1');

		doc.replaceRange('X', {ch: 0, line: 0});
		settle();
		jest.advanceTimersByTime(COMMIT_DELAY_MS - 10);
		expect(deps.commit).not.toHaveBeenCalled();
		doc.replaceRange('Y', {ch: 0, line: 0});
		settle();
		jest.advanceTimersByTime(COMMIT_DELAY_MS - 10);
		expect(deps.commit).not.toHaveBeenCalled();
		jest.advanceTimersByTime(20);
		expect(deps.commit).toHaveBeenCalledTimes(1);
		expect(deps.commit).toHaveBeenCalledWith('s', 'p1', 'YXhello\nworld');
	});

	it('flushes on release, even before the change event arrives', () => {
		const {deps, registry} = setup();
		const handle = registry.acquire('s', 'p1');

		handle.doc.replaceRange('X', {ch: 0, line: 0});
		registry.release(handle);
		expect(deps.commit).toHaveBeenCalledWith('s', 'p1', 'Xhello\nworld');
		settle();
		jest.advanceTimersByTime(COMMIT_DELAY_MS * 2);
		expect(deps.commit).toHaveBeenCalledTimes(1);
	});

	it('flush() commits now and cancels the timer', () => {
		const {deps, registry} = setup();
		const handle = registry.acquire('s', 'p1');

		handle.doc.replaceRange('X', {ch: 0, line: 0});
		settle();
		handle.flush();
		expect(deps.commit).toHaveBeenCalledTimes(1);
		jest.advanceTimersByTime(COMMIT_DELAY_MS * 2);
		expect(deps.commit).toHaveBeenCalledTimes(1);
	});

	it('claims the lock on the first local write, not on acquire', () => {
		const {deps, registry} = setup();
		const handle = registry.acquire('s', 'p1');

		expect(deps.claim).not.toHaveBeenCalled();
		handle.doc.replaceRange('X', {ch: 0, line: 0});
		settle();
		handle.doc.replaceRange('Y', {ch: 0, line: 0});
		settle();
		expect(deps.claim).toHaveBeenCalledTimes(1);
		expect(deps.claim).toHaveBeenCalledWith('s', 'p1');
		registry.release(handle);
		expect(deps.unclaim).toHaveBeenCalledWith('s', 'p1');
	});

	it('claims on demand (take edit), once', () => {
		const {deps, registry} = setup();
		const handle = registry.acquire('s', 'p1');

		handle.claim();
		handle.doc.replaceRange('X', {ch: 0, line: 0});
		settle();
		expect(deps.claim).toHaveBeenCalledTimes(1);
		registry.release(handle);
		expect(deps.unclaim).toHaveBeenCalledTimes(1);
	});

	it('does not unclaim what it never claimed', () => {
		const {deps, registry} = setup();

		registry.release(registry.acquire('s', 'p1'));
		expect(deps.unclaim).not.toHaveBeenCalled();
	});

	it('pulls a store change into the Doc as its own undo step', () => {
		const {deps, registry, store} = setup();
		const {doc} = registry.acquire('s', 'p1');

		doc.replaceRange('X', {ch: 0, line: 0});
		settle();
		jest.advanceTimersByTime(COMMIT_DELAY_MS);
		store.p1 = 'Xhello\nthere';
		registry.syncFromStore();
		settle();
		expect(doc.getValue()).toBe('Xhello\nthere');
		// Not a local write: no new commit, no timer.
		jest.advanceTimersByTime(COMMIT_DELAY_MS * 2);
		expect(deps.commit).toHaveBeenCalledTimes(1);
		doc.undo();
		expect(doc.getValue()).toBe('Xhello\nworld');
		doc.undo();
		expect(doc.getValue()).toBe('hello\nworld');
	});

	it('keeps the caret where a remote edit elsewhere leaves it', () => {
		const {registry, store} = setup({p1: 'aaa\nbbb\nccc'});
		const {doc} = registry.acquire('s', 'p1');

		doc.setCursor({ch: 1, line: 2});
		store.p1 = 'aaa\nBBBB\nccc';
		registry.syncFromStore();
		expect(doc.getCursor()).toEqual(expect.objectContaining({ch: 1, line: 2}));
	});

	it('ignores the store while a local write is pending', () => {
		const {registry, store} = setup();
		const {doc} = registry.acquire('s', 'p1');

		doc.replaceRange('X', {ch: 0, line: 0});
		// Before the change event, and after it: both are pending.
		store.p1 = 'remote';
		registry.syncFromStore();
		expect(doc.getValue()).toBe('Xhello\nworld');
		settle();
		registry.syncFromStore();
		expect(doc.getValue()).toBe('Xhello\nworld');
	});

	it('does not write back its own commit', () => {
		const {registry} = setup();
		const {doc} = registry.acquire('s', 'p1');
		const changes = jest.fn();

		doc.replaceRange('X', {ch: 0, line: 0});
		settle();
		jest.advanceTimersByTime(COMMIT_DELAY_MS);
		(doc as any).on('change', changes);
		registry.syncFromStore();
		settle();
		expect(changes).not.toHaveBeenCalled();
	});

	it('skips the commit for a passage deleted under it', () => {
		const {deps, registry, store} = setup();
		const handle = registry.acquire('s', 'p1');

		handle.doc.replaceRange('X', {ch: 0, line: 0});
		store.p1 = undefined;
		expect(() => registry.release(handle)).not.toThrow();
		expect(deps.commit).not.toHaveBeenCalled();
	});

	it('notifies subscribers on every write', () => {
		const {registry, store} = setup();
		const handle = registry.acquire('s', 'p1');
		const listener = jest.fn();

		handle.subscribe(listener);
		handle.doc.replaceRange('X', {ch: 0, line: 0}, undefined, '+drag');
		settle();
		expect(listener).toHaveBeenCalledTimes(1);
		jest.advanceTimersByTime(COMMIT_DELAY_MS);
		store.p1 = 'other';
		registry.syncFromStore();
		settle();
		expect(listener).toHaveBeenCalledTimes(2);
		expect(handle.doc.getValue()).toBe('other');
	});

	it('shares undo between headless writes and later ones', () => {
		const {registry} = setup({p1: 'x: 1'});
		const {doc} = registry.acquire('s', 'p1');

		doc.replaceRange('2', {ch: 3, line: 0}, {ch: 4, line: 0}, '+drag');
		doc.replaceRange('3', {ch: 3, line: 0}, {ch: 4, line: 0}, '+drag');
		expect(doc.getValue()).toBe('x: 3');
		// Same origin, back to back: one history event.
		doc.undo();
		expect(doc.getValue()).toBe('x: 1');
		doc.redo();
		expect(doc.getValue()).toBe('x: 3');
	});

	it('hands a second view a linked Doc with shared history', () => {
		const {registry} = setup({p1: 'abc'});
		const handle = registry.acquire('s', 'p1');
		const one = {} as CodeMirror.Editor;
		const two = {} as CodeMirror.Editor;

		expect(registry.attachView(handle, one)).toBe(handle.doc);

		const linked = registry.attachView(handle, two);

		expect(linked).not.toBe(handle.doc);
		linked.replaceRange('Z', {ch: 0, line: 0});
		expect(handle.doc.getValue()).toBe('Zabc');
		handle.doc.undo();
		expect(linked.getValue()).toBe('abc');
		expect(handle.view()).toBe(one);
		registry.detachView(handle, one, handle.doc);
		expect(handle.view()).toBe(two);
		registry.detachView(handle, two, linked);
		expect(handle.view()).toBeUndefined();
		linked.replaceRange('Q', {ch: 0, line: 0});
		expect(handle.doc.getValue()).toBe('abc');
	});

	it('flushAll commits everything pending', () => {
		const {deps, registry} = setup({p1: 'a', p2: 'b'});

		registry.acquire('s', 'p1').doc.replaceRange('1', {ch: 0, line: 0});
		registry.acquire('s', 'p2').doc.replaceRange('2', {ch: 0, line: 0});
		registry.flushAll();
		expect(deps.commit).toHaveBeenCalledWith('s', 'p1', '1a');
		expect(deps.commit).toHaveBeenCalledWith('s', 'p2', '2b');
	});

	it('ignores store origin when claiming', () => {
		const {deps, registry} = setup();
		const {doc} = registry.acquire('s', 'p1');

		doc.replaceRange('Q', {ch: 0, line: 0}, undefined, STORE_ORIGIN);
		settle();
		expect(deps.claim).not.toHaveBeenCalled();
	});
});

describe('minimalEdit', () => {
	it.each([
		['abc', 'abc', undefined],
		['abc', 'abXc', {end: 2, start: 2, text: 'X'}],
		['abc', 'ac', {end: 2, start: 1, text: ''}],
		['', 'new', {end: 0, start: 0, text: 'new'}],
		['aaa', 'aa', {end: 3, start: 2, text: ''}],
		['old', '', {end: 3, start: 0, text: ''}]
	])('%j -> %j', (from, to, expected) => {
		expect(minimalEdit(from, to)).toEqual(expected);

		if (expected) {
			expect(
				from.slice(0, expected.start) + expected.text + from.slice(expected.end)
			).toBe(to);
		}
	});
});
