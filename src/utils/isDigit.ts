/**
 * Check whether a given string of length 1 is a digit.
 * 
 * @param c The given character, stored in a string.
 * @returns Whether the string is a single digit.
 */
export default function isDigit(c: string): boolean {
	return c.length === 1 && c >= '0' && c <= '9';
}
