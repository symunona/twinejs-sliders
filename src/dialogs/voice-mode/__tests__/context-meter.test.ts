import {shortTokens} from '../context-meter';

describe('shortTokens', () => {
	it('is exact below a thousand', () => {
		expect(shortTokens(0)).toBe('0');
		expect(shortTokens(999)).toBe('999');
	});

	it('keeps a decimal where it still tells you something', () => {
		expect(shortTokens(1000)).toBe('1.0k');
		expect(shortTokens(9_949)).toBe('9.9k');
	});

	it('drops it once the number is long enough not to need it', () => {
		expect(shortTokens(12_400)).toBe('12k');
		expect(shortTokens(999_000)).toBe('999k');
	});

	it('goes to millions rather than printing six digits', () => {
		expect(shortTokens(1_048_576)).toBe('1.0M');
	});
});
