import { describe, expect, test } from 'bun:test'
import { Result } from 'better-result'
import {
	collapseRuns,
	expandNameTemplate,
	expandStub,
	expandStubs,
	stubPowerError,
} from './templates'

function names(template: string): string[] {
	const expanded = expandNameTemplate(template)
	return Result.isOk(expanded) ? expanded.value : [`error: ${expanded.error.message}`]
}

describe('expandNameTemplate', () => {
	test('leaves a plain name alone', () => {
		expect(names('Büro 1')).toEqual(['Büro 1'])
	})

	test('expands numeric, alphabetic and listed choices', () => {
		expect(names('Gi1/0/[1-3]')).toEqual(['Gi1/0/1', 'Gi1/0/2', 'Gi1/0/3'])
		expect(names('[a-b]x')).toEqual(['ax', 'bx'])
		expect(names('[wan,lan]')).toEqual(['wan', 'lan'])
	})

	test('keeps the padding of a range and combines groups', () => {
		expect(names('p[08-10]')).toEqual(['p08', 'p09', 'p10'])
		expect(names('[1-2]/[a-b]')).toEqual(['1/a', '1/b', '2/a', '2/b'])
	})

	test.each([
		['eth[1-', 'unbalanced'],
		['eth1]', 'unbalanced'],
		['eth[3-1]', 'backwards'],
		['eth[1,]', 'empty or invalid'],
		['[1-999][1-999]', 'more than 1000'],
	])('refuses %s', (template, message) => {
		expect(names(template)[0]).toContain(message)
	})
})

describe('collapseRuns', () => {
	test('collapses a run from 1 and keeps what expandStub rebuilds', () => {
		const list = ['eth1', 'eth2', 'eth3', 'mgmt']
		const runs = collapseRuns(list)
		expect(runs).toEqual([
			{ prefix: 'eth', count: 3, digits: 1, start: 1 },
			{ prefix: 'mgmt', count: 1, digits: 1, start: 1 },
		])
		const rebuilt = runs.flatMap((run) => {
			const expanded = expandStub(run)
			return Result.isOk(expanded) ? expanded.value : []
		})
		expect(rebuilt).toEqual(list)
	})

	test('collapses a run that starts above 1 from its first number', () => {
		expect(collapseRuns(['Gi25', 'Gi26'])).toEqual([
			{ prefix: 'Gi', count: 2, digits: 2, start: 25 },
		])
	})

	test('keeps the separator space and the padding of a run', () => {
		expect(collapseRuns(['Port 09', 'Port 10', 'Port 11', 'Port 1'])).toEqual([
			{ prefix: 'Port ', count: 3, digits: 2, start: 9 },
			{ prefix: 'Port 1', count: 1, digits: 1, start: 1 },
		])
	})
})

describe('expandStubs', () => {
	const rear = { id: 1, prefix: 'R', count: 1, kind: 'mpo', side: 'rear' as const, positions: 2 }
	const front = { prefix: 'F', kind: 'lc', side: 'front' as const, rear_stub_id: 1 }

	test('maps front ports onto the slots of their rear port', () => {
		const ports = expandStubs([rear, { ...front, count: 2, rear_position: 1 }])
		expect(Result.isOk(ports) && ports.value.map((port) => port.rear_port_position)).toEqual([
			null,
			1,
			2,
		])
	})

	test('refuses a front stub past the rear port and two on one slot', () => {
		expect(Result.isError(expandStubs([rear, { ...front, count: 3 }]))).toBe(true)
		expect(
			Result.isError(
				expandStubs([
					rear,
					{ ...front, count: 1, rear_position: 1 },
					{ ...front, prefix: 'G', count: 1, rear_position: 1 },
				]),
			),
		).toBe(true)
	})

	test('refuses two stubs producing one name', () => {
		expect(
			Result.isError(
				expandStubs([
					{ prefix: 'eth', count: 2, kind: 'ethernet' },
					{ prefix: 'eth1', count: 1, kind: 'ethernet' },
				]),
			),
		).toBe(true)
	})
})

describe('stubPowerError', () => {
	test('keeps a maximum draw on power inputs and PoE on network interfaces', () => {
		const stub = { prefix: 'p', count: 1 }
		expect(stubPowerError({ ...stub, kind: 'power', maximum_draw: 60 })).toBeNull()
		expect(stubPowerError({ ...stub, kind: 'ethernet', maximum_draw: 60 })).toContain('power')
		expect(stubPowerError({ ...stub, kind: 'ethernet', poe_mode: 'pse' })).toBeNull()
		expect(stubPowerError({ ...stub, kind: 'hdmi', poe_mode: 'pse' })).toContain('PoE')
		expect(stubPowerError({ ...stub, kind: 'ethernet', poe_type: 'x' })).toContain('PoE mode')
	})
})
