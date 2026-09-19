import { describe, expect, test } from 'bun:test'
import { Result } from 'better-result'
import {
	buildChildrenMap,
	buildParentMap,
	createsCycle,
	depthOf,
	maxDescendantOffset,
} from './hierarchy'

describe('depthOf', () => {
	test('root has depth 1', () => {
		const parents = buildParentMap([{ id: 1, parent_id: null }])
		const res = depthOf(1, parents)
		expect(Result.isOk(res)).toBe(true)
		if (Result.isOk(res)) {
			expect(res.value).toBe(1)
		}
	})

	test('three-level chain has depth 3', () => {
		const parents = buildParentMap([
			{ id: 1, parent_id: null },
			{ id: 2, parent_id: 1 },
			{ id: 3, parent_id: 2 },
		])
		const res = depthOf(3, parents)
		expect(Result.isOk(res)).toBe(true)
		if (Result.isOk(res)) {
			expect(res.value).toBe(3)
		}
	})

	test('unknown id errors', () => {
		const parents = buildParentMap([{ id: 1, parent_id: null }])
		expect(Result.isError(depthOf(999, parents))).toBe(true)
	})

	test('cycle errors instead of looping', () => {
		const parents = new Map<number, number | null>([
			[1, 2],
			[2, 1],
		])
		expect(Result.isError(depthOf(1, parents))).toBe(true)
	})
})

describe('createsCycle', () => {
	const parents = buildParentMap([
		{ id: 1, parent_id: null },
		{ id: 2, parent_id: 1 },
		{ id: 3, parent_id: 2 },
		{ id: 4, parent_id: 1 },
	])

	test('self-parent is a cycle', () => {
		expect(createsCycle(2, 2, parents)).toBe(true)
	})

	test('parenting under a descendant is a cycle', () => {
		expect(createsCycle(1, 3, parents)).toBe(true)
	})

	test('parenting under an ancestor is fine', () => {
		expect(createsCycle(3, 1, parents)).toBe(false)
	})

	test('parenting under a sibling subtree is fine', () => {
		expect(createsCycle(3, 4, parents)).toBe(false)
	})
})

describe('maxDescendantOffset', () => {
	test('leaf has offset 0', () => {
		const children = buildChildrenMap([{ id: 1, parent_id: null }])
		expect(maxDescendantOffset(1, children)).toBe(0)
	})

	test('chain of three below the node has offset 2', () => {
		const children = buildChildrenMap([
			{ id: 1, parent_id: null },
			{ id: 2, parent_id: 1 },
			{ id: 3, parent_id: 2 },
		])
		expect(maxDescendantOffset(1, children)).toBe(2)
	})

	test('takes the deepest branch', () => {
		const children = buildChildrenMap([
			{ id: 1, parent_id: null },
			{ id: 2, parent_id: 1 },
			{ id: 3, parent_id: 1 },
			{ id: 4, parent_id: 3 },
			{ id: 5, parent_id: 4 },
		])
		expect(maxDescendantOffset(1, children)).toBe(3)
		expect(maxDescendantOffset(2, children)).toBe(0)
	})
})
