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
		const parents = buildParentMap([{ id: 'a', parent_id: null }])
		const res = depthOf('a', parents)
		expect(Result.isOk(res)).toBe(true)
		if (Result.isOk(res)) {
			expect(res.value).toBe(1)
		}
	})

	test('three-level chain has depth 3', () => {
		const parents = buildParentMap([
			{ id: 'a', parent_id: null },
			{ id: 'b', parent_id: 'a' },
			{ id: 'c', parent_id: 'b' },
		])
		const res = depthOf('c', parents)
		expect(Result.isOk(res)).toBe(true)
		if (Result.isOk(res)) {
			expect(res.value).toBe(3)
		}
	})

	test('unknown id errors', () => {
		const parents = buildParentMap([{ id: 'a', parent_id: null }])
		expect(Result.isError(depthOf('missing', parents))).toBe(true)
	})

	test('cycle errors instead of looping', () => {
		const parents = new Map<string, string | null>([
			['a', 'b'],
			['b', 'a'],
		])
		expect(Result.isError(depthOf('a', parents))).toBe(true)
	})
})

describe('createsCycle', () => {
	const parents = buildParentMap([
		{ id: 'a', parent_id: null },
		{ id: 'b', parent_id: 'a' },
		{ id: 'c', parent_id: 'b' },
		{ id: 'sibling', parent_id: 'a' },
	])

	test('self-parent is a cycle', () => {
		expect(createsCycle('b', 'b', parents)).toBe(true)
	})

	test('parenting under a descendant is a cycle', () => {
		expect(createsCycle('a', 'c', parents)).toBe(true)
	})

	test('parenting under an ancestor is fine', () => {
		expect(createsCycle('c', 'a', parents)).toBe(false)
	})

	test('parenting under a sibling subtree is fine', () => {
		expect(createsCycle('c', 'sibling', parents)).toBe(false)
	})
})

describe('maxDescendantOffset', () => {
	test('leaf has offset 0', () => {
		const children = buildChildrenMap([{ id: 'a', parent_id: null }])
		expect(maxDescendantOffset('a', children)).toBe(0)
	})

	test('chain of three below the node has offset 2', () => {
		const children = buildChildrenMap([
			{ id: 'a', parent_id: null },
			{ id: 'b', parent_id: 'a' },
			{ id: 'c', parent_id: 'b' },
		])
		expect(maxDescendantOffset('a', children)).toBe(2)
	})

	test('takes the deepest branch', () => {
		const children = buildChildrenMap([
			{ id: 'a', parent_id: null },
			{ id: 'b', parent_id: 'a' },
			{ id: 'c', parent_id: 'a' },
			{ id: 'd', parent_id: 'c' },
			{ id: 'e', parent_id: 'd' },
		])
		expect(maxDescendantOffset('a', children)).toBe(3)
		expect(maxDescendantOffset('b', children)).toBe(0)
	})
})
