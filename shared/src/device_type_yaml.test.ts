import { describe, expect, test } from 'bun:test'
import * as v from 'valibot'
import { DeviceTypeYamlSchema } from './schemas'

const base = { manufacturer: 'Acme', model: 'X1' }
const accepts = (entry: object): boolean =>
	v.safeParse(DeviceTypeYamlSchema, { ...base, ...entry }).success

describe('DeviceTypeYamlSchema', () => {
	test('defaults like the importer and keeps other NetBox keys', () => {
		expect(v.parse(DeviceTypeYamlSchema, { ...base, slug: 'acme-x1' })).toMatchObject({
			u_height: 1,
			is_full_depth: true,
			slug: 'acme-x1',
		})
	})

	test('coerces a height arriving as text', () => {
		expect(v.parse(DeviceTypeYamlSchema, { ...base, u_height: '2' }).u_height).toBe(2)
	})

	test.each([[-1], [61], [1.5], ['abc']])('refuses u_height %p', (u_height) => {
		expect(accepts({ u_height })).toBe(false)
	})

	test('needs a manufacturer and a model', () => {
		expect(v.safeParse(DeviceTypeYamlSchema, { model: 'X1' }).success).toBe(false)
		expect(v.safeParse(DeviceTypeYamlSchema, { manufacturer: 'Acme' }).success).toBe(false)
		expect(accepts({ model: '  ' })).toBe(false)
	})

	test('takes null for the conex keys, which clears them on update', () => {
		expect(
			accepts({
				default_device_role: null,
				part_number: null,
				spec_url: null,
				eol_date: null,
			}),
		).toBe(true)
	})

	test('checks the conex keys', () => {
		expect(accepts({ eol_date: '2031-03-01', spec_url: 'example.com/spec' })).toBe(true)
		expect(accepts({ eol_date: '2031-02-30' })).toBe(false)
		expect(accepts({ spec_url: 'not a url' })).toBe(false)
		expect(accepts({ part_number: 'x'.repeat(101) })).toBe(false)
		expect(accepts({ description: 'x'.repeat(250) })).toBe(true)
		expect(accepts({ description: 'x'.repeat(251) })).toBe(false)
		expect(accepts({ comments: 'x'.repeat(2001) })).toBe(false)
	})
})
