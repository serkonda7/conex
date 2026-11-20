import { describe, expect, test } from 'bun:test'
import { spreadApart } from './marker_spread'

const GAP = 32

function distance(a: [number, number], b: [number, number]): number {
	return Math.hypot(a[0] - b[0], a[1] - b[1])
}

/** Where the markers end up: point plus offset. */
function placed(points: [number, number][], fixed?: boolean[]): [number, number][] {
	return spreadApart(points, GAP, fixed).map(([dx, dy], i): [number, number] => [
		points[i][0] + dx,
		points[i][1] + dy,
	])
}

describe('spreadApart', () => {
	test('keeps markers that do not overlap where the editor draws them', () => {
		const points: [number, number][] = [
			[100, 100],
			[100 + GAP, 100],
			[300, 40],
		]
		expect(spreadApart(points, GAP)).toEqual([
			[0, 0],
			[0, 0],
			[0, 0],
		])
	})

	test('leaves a far-away marker alone while a crowd is spread', () => {
		const offsets = spreadApart(
			[
				[100, 100],
				[110, 100],
				[500, 500],
			],
			GAP,
		)
		expect(offsets[2]).toEqual([0, 0])
	})

	test('pushes an overlapping crowd apart just enough and keeps its arrangement', () => {
		// The case from the bug: phone left, Wi-Fi right, device above, all overlapping.
		const points: [number, number][] = [
			[100, 110],
			[115, 112],
			[108, 100],
		]
		const at = placed(points)
		for (let i = 0; i < at.length; i++) {
			for (let j = i + 1; j < at.length; j++) {
				expect(distance(at[i], at[j])).toBeGreaterThanOrEqual(GAP - 0.5)
			}
		}
		// Left stays left, the one on top stays on top.
		expect(at[0][0]).toBeLessThan(at[1][0])
		expect(at[2][1]).toBeLessThan(at[0][1])
		expect(at[2][1]).toBeLessThan(at[1][1])
		// No marker moves further than the gap.
		for (let i = 0; i < at.length; i++) {
			expect(distance(at[i], points[i])).toBeLessThan(GAP)
		}
	})

	test('fans out markers on the same spot', () => {
		const at = placed([
			[200, 200],
			[200, 200],
			[200, 200],
		])
		for (let i = 0; i < at.length; i++) {
			for (let j = i + 1; j < at.length; j++) {
				expect(distance(at[i], at[j])).toBeGreaterThanOrEqual(GAP - 0.5)
			}
		}
	})

	test('never moves a fixed (selected) marker', () => {
		const offsets = spreadApart(
			[
				[100, 100],
				[105, 100],
			],
			GAP,
			[true, false],
		)
		expect(offsets[0]).toEqual([0, 0])
		expect(offsets[1][0]).toBeCloseTo(GAP - 5)
	})
})
