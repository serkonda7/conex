import { describe, expect, test } from 'bun:test'
import { Result } from 'better-result'
import { checkBounds, checkOverlap, getOccupancy, rangesOverlap, spanRange } from './occupancy'

describe('spanRange', () => {
	test('shelf at U10 h1 occupies exactly U10', () => {
		expect(spanRange({ position_u: 10, height_u: 1 })).toEqual([10, 10])
	})

	test('multi-U span covers position..position+height-1', () => {
		expect(spanRange({ position_u: 10, height_u: 3 })).toEqual([10, 12])
	})
})

describe('rangesOverlap', () => {
	test('adjacent spans do not overlap', () => {
		expect(rangesOverlap([10, 10], [11, 11])).toBe(false)
	})

	test('touching multi-U spans overlap on the shared U', () => {
		expect(rangesOverlap([10, 11], [11, 12])).toBe(true)
	})

	test('identical ranges overlap', () => {
		expect(rangesOverlap([10, 12], [10, 12])).toBe(true)
	})
})

describe('checkBounds', () => {
	test('U10 h1 fits in a 42U rack', () => {
		expect(Result.isOk(checkBounds({ position_u: 10, height_u: 1 }, 42, 'Shelf "s"'))).toBe(
			true,
		)
	})

	test('position below 1 is rejected', () => {
		expect(Result.isError(checkBounds({ position_u: 0, height_u: 1 }, 42, 'Shelf "s"'))).toBe(
			true,
		)
	})

	test('span topping out of the rack is rejected', () => {
		expect(Result.isError(checkBounds({ position_u: 42, height_u: 2 }, 42, 'Shelf "s"'))).toBe(
			true,
		)
	})

	test('span exactly filling the top is accepted', () => {
		expect(Result.isOk(checkBounds({ position_u: 41, height_u: 2 }, 42, 'Shelf "s"'))).toBe(
			true,
		)
	})
})

describe('checkOverlap', () => {
	test('non-overlapping siblings pass', () => {
		const res = checkOverlap(
			{ id: 'b', name: 'b', position_u: 12, height_u: 1 },
			[{ id: 'a', name: 'a', position_u: 10, height_u: 1 }],
			'Shelf "b"',
		)
		expect(Result.isOk(res)).toBe(true)
	})

	test('overlapping sibling is rejected', () => {
		const res = checkOverlap(
			{ id: 'b', name: 'b', position_u: 10, height_u: 2 },
			[{ id: 'a', name: 'a', position_u: 10, height_u: 1 }],
			'Shelf "b"',
		)
		expect(Result.isError(res)).toBe(true)
	})

	test('excluded id (self on update) does not conflict', () => {
		const res = checkOverlap(
			{ id: 'a', name: 'a', position_u: 10, height_u: 1 },
			[{ id: 'a', name: 'a', position_u: 10, height_u: 1 }],
			'Shelf "a"',
			'a',
		)
		expect(Result.isOk(res)).toBe(true)
	})
})

describe('getOccupancy', () => {
	test('42U rack with a shelf at U10 h1 marks exactly U10', () => {
		const res = getOccupancy(42, [{ id: 's1', name: 'shelf', position_u: 10, height_u: 1 }])
		expect(Result.isOk(res)).toBe(true)
		if (Result.isError(res)) {
			return
		}
		expect(res.value.height_u).toBe(42)
		expect(res.value.units).toHaveLength(42)
		for (const unit of res.value.units) {
			if (unit.u === 10) {
				expect(unit.shelf).toEqual({ id: 's1', name: 'shelf' })
			} else {
				expect(unit.shelf).toBeNull()
			}
			expect(unit.device).toBeNull()
		}
	})

	test('multi-U shelf fills every covered U', () => {
		const res = getOccupancy(42, [{ id: 's1', name: 'big', position_u: 5, height_u: 3 }])
		expect(Result.isOk(res)).toBe(true)
		if (Result.isError(res)) {
			return
		}
		const filled = res.value.units.filter((u) => u.shelf !== null).map((u) => u.u)
		expect(filled).toEqual([5, 6, 7])
	})

	test('overlapping shelves are rejected', () => {
		const res = getOccupancy(42, [
			{ id: 'a', name: 'a', position_u: 10, height_u: 2 },
			{ id: 'b', name: 'b', position_u: 11, height_u: 1 },
		])
		expect(Result.isError(res)).toBe(true)
	})

	test('out-of-bounds shelf is rejected', () => {
		const res = getOccupancy(42, [{ id: 'a', name: 'a', position_u: 42, height_u: 2 }])
		expect(Result.isError(res)).toBe(true)
	})
})
