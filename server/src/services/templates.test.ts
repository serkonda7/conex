import { describe, expect, test } from 'bun:test'
import { Result } from 'better-result'
import { expandStub, expandStubs } from './templates'

describe('expandStub', () => {
	test('eth x24 expands to eth0..eth23', () => {
		const result = expandStub('eth', 24)
		expect(Result.isOk(result)).toBe(true)
		if (Result.isOk(result)) {
			expect(result.value).toHaveLength(24)
			expect(result.value[0]).toBe('eth0')
			expect(result.value[23]).toBe('eth23')
		}
	})

	test('count of 1 yields a single zero-suffixed name', () => {
		const result = expandStub('mgmt', 1)
		expect(Result.isOk(result)).toBe(true)
		if (Result.isOk(result)) {
			expect(result.value).toEqual(['mgmt0'])
		}
	})

	test('empty prefix and count below 1 are rejected', () => {
		expect(Result.isError(expandStub('  ', 4))).toBe(true)
		expect(Result.isError(expandStub('eth', 0))).toBe(true)
		expect(Result.isError(expandStub('eth', -2))).toBe(true)
		expect(Result.isError(expandStub('eth', 1.5))).toBe(true)
	})
})

describe('expandStubs', () => {
	test('multiple stubs concatenate in order with kind and label', () => {
		const result = expandStubs([
			{ prefix: 'eth', count: 2, kind: 'ethernet', label: null },
			{ prefix: 'sfp', count: 2, kind: 'fiber', label: 'uplink' },
		])
		expect(Result.isOk(result)).toBe(true)
		if (Result.isOk(result)) {
			expect(result.value.map((i) => i.name)).toEqual(['eth0', 'eth1', 'sfp0', 'sfp1'])
			expect(result.value[2]?.kind).toBe('fiber')
			expect(result.value[2]?.label).toBe('uplink')
			expect(result.value[0]?.label).toBeNull()
		}
	})

	test('empty stub list expands to nothing', () => {
		const result = expandStubs([])
		expect(Result.isOk(result)).toBe(true)
		if (Result.isOk(result)) {
			expect(result.value).toEqual([])
		}
	})

	test('overlapping expansions are rejected', () => {
		const result = expandStubs([
			{ prefix: 'eth', count: 2, kind: 'ethernet' },
			{ prefix: 'eth', count: 1, kind: 'ethernet' },
		])
		expect(Result.isError(result)).toBe(true)
	})
})
