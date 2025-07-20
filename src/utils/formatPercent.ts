/**
 * Format a scalar value using percent notation.
 * 
 * @param value A number in the zero to one range.
 * @returns A string representing the number in percent notation.
 */
export default function formatPercent(value: number) {
	return `${(value * 100).toFixed(1)}%`;
}
