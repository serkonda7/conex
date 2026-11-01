/**
 * Finds existing device types a typed model probably refers to. The server
 * search is a plain substring match, which misses spelling variants such as
 * "C9300-48P" and "Catalyst 9300 48P", so this runs over the loaded types.
 */

/** Shorter names match too much to be a useful hint. */
const MIN_MATCH_LENGTH = 3

/** Lowercase letters and digits only: `C9300-48P` → `c930048p`. */
function compact(text: string): string {
	return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/** Words carrying a digit, which identify a model better than its product line. */
function modelNumbers(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((word) => /\p{N}/u.test(word))
}

/** All model numbers of `model` occur in `other`, at least one of them distinctive. */
function hasModelNumbersOf(model: string, other: string): boolean {
	const numbers = modelNumbers(model)
	const target = compact(other)
	return (
		numbers.some((number) => number.length >= MIN_MATCH_LENGTH) &&
		numbers.every((number) => target.includes(number))
	)
}

function isSimilar(model: string, other: string): boolean {
	const a = compact(model)
	const b = compact(other)
	if (a === b) {
		return a !== ''
	}
	if (Math.min(a.length, b.length) < MIN_MATCH_LENGTH) {
		return false
	}
	return (
		a.includes(b) ||
		b.includes(a) ||
		hasModelNumbersOf(model, other) ||
		hasModelNumbersOf(other, model)
	)
}

/**
 * Types similar to `model`, identical spellings first. `manufacturerId` limits
 * the search to one manufacturer; `null` searches all of them.
 */
export function findSimilarTypes<T extends { model: string; manufacturer_id: number }>(
	model: string,
	manufacturerId: number | null,
	types: readonly T[],
): T[] {
	const isExact = (type: T): boolean => compact(type.model) === compact(model)
	return types
		.filter(
			(type) =>
				(manufacturerId === null || type.manufacturer_id === manufacturerId) &&
				isSimilar(model, type.model),
		)
		.sort((a, b) => Number(isExact(b)) - Number(isExact(a)))
}
