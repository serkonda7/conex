import { Result } from 'better-result'
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
	CableImportRowSchema,
	DeviceImportRowSchema,
	DeviceTypeImportRowSchema,
	type ImportResponse,
	type ImportRowResult,
} from 'shared/src/schemas'
import * as v from 'valibot'
import { cables, device_types, devices, interfaces, manufacturers, racks, sites } from '../schema'
import { parseCsv, rowsToObjects, toCsv } from '../util/csv'
import { formatValibotIssues } from '../util/valibot'
import { connectCable } from './cables'
import { getDb } from './connection'
import { createDevice } from './devices'
import { createDeviceType, createStub } from './templates'

export const DEVICE_CSV_HEADER = [
	'name',
	'asset_tag',
	'device_type_model',
	'site_slug',
	'rack_name',
	'position_u',
	'status',
]

export const CABLE_CSV_HEADER = [
	'a_device',
	'a_interface',
	'b_device',
	'b_interface',
	'label',
	'kind',
	'status',
]

export const DEVICE_TYPE_CSV_HEADER = [
	'manufacturer_slug',
	'model',
	'u_height',
	'is_full_depth',
	'form_factor',
	'width',
	'description',
]

/** Device-type export: one row per type, manufacturer as slug for re-import. */
export function exportDeviceTypesCsv(): string {
	const db = getDb()
	const rows = db
		.select({
			manufacturer_slug: manufacturers.slug,
			model: device_types.model,
			u_height: device_types.u_height,
			is_full_depth: device_types.is_full_depth,
			form_factor: device_types.form_factor,
			width: device_types.width,
			description: device_types.description,
			comments: device_types.comments,
		})
		.from(device_types)
		.leftJoin(manufacturers, eq(device_types.manufacturer_id, manufacturers.id))
		.orderBy(device_types.model)
		.all()
	return toCsv(
		DEVICE_TYPE_CSV_HEADER,
		rows.map((r) => [
			r.manufacturer_slug,
			r.model,
			String(r.u_height),
			r.is_full_depth ? 'true' : 'false',
			r.form_factor,
			r.width === null ? null : String(r.width),
			r.description,
		]),
	)
}

/**
 * Device-type import: validates each row with `DeviceTypeImportRowSchema`,
 * resolves `manufacturer_slug` to an id, and creates the type. One bad row
 * fails only itself; the response reports per-row errors.
 */
export function importDeviceTypesCsv(text: string): Result<ImportResponse, Error> {
	const parsed = parseCsv(text)
	if (Result.isError(parsed)) {
		return Result.err(parsed.error)
	}
	const mfrBySlug = new Map(
		getDb()
			.select()
			.from(manufacturers)
			.all()
			.map((r) => [r.slug, r.id]),
	)
	const rows: ImportRowResult[] = []
	for (const [index, obj] of rowsToObjects(parsed.value.header, parsed.value.rows).entries()) {
		const rowNumber = index + 2
		const fail = (error: string): void => {
			rows.push({ row: rowNumber, ok: false, id: null, error })
		}
		const validated = v.safeParse(DeviceTypeImportRowSchema, obj)
		if (!validated.success) {
			fail(formatValibotIssues(validated.issues))
			continue
		}
		const input = validated.output
		const mfrId = mfrBySlug.get(input.manufacturer_slug)
		if (!mfrId) {
			fail(`Unknown manufacturer_slug "${input.manufacturer_slug}"`)
			continue
		}
		const created = createDeviceType({
			manufacturer_id: mfrId,
			model: input.model,
			u_height: input.u_height ?? 1,
			is_full_depth: input.is_full_depth ?? true,
			form_factor: input.form_factor,
			width: (input.width ?? undefined) as 10 | 19 | 23 | undefined,
			description: input.description,
			comments: input.comments,
		})
		if (Result.isError(created)) {
			fail(created.error.message)
			continue
		}
		rows.push({ row: rowNumber, ok: true, id: created.value.id, error: null })
	}
	return Result.ok(importResult(rows))
}

/** Thrown inside the import transaction to roll back after a failed row. */
class ImportRollback extends Error {}

/**
 * Imports the device-type YAML used by NetBox's device-type library. NetBox
 * uses manufacturer names (rather than Conex manufacturer slugs), and one
 * YAML document represents one device type. A YAML sequence is accepted too,
 * which makes pasting a collection of library definitions convenient.
 *
 * All-or-nothing: every row is validated and reported, but if any row fails
 * the whole import is rolled back and the rows that would have succeeded come
 * back as `ok: false` with no error.
 */
export function importDeviceTypesYaml(text: string): Result<ImportResponse, Error> {
	let parsed: unknown
	try {
		parsed = Bun.YAML.parse(text)
	} catch (error) {
		return Result.err(
			new Error(`Invalid YAML: ${error instanceof Error ? error.message : String(error)}`),
		)
	}
	const definitions = Array.isArray(parsed) ? parsed : [parsed]
	const rows: ImportRowResult[] = []
	try {
		getDb().transaction(() => {
			for (const [index, definition] of definitions.entries()) {
				rows.push({ row: index + 1, ...importDeviceTypeDefinition(definition) })
			}
			if (rows.some((r) => !r.ok)) {
				throw new ImportRollback()
			}
		})
	} catch (err) {
		if (!(err instanceof ImportRollback)) {
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
		for (const r of rows) {
			if (r.ok) {
				r.ok = false
				r.id = null
			}
		}
	}
	return Result.ok(importResult(rows))
}

/** Creates one NetBox device-type definition with its ports. */
function importDeviceTypeDefinition(definition: unknown): Omit<ImportRowResult, 'row'> {
	const fail = (error: string): Omit<ImportRowResult, 'row'> => ({ ok: false, id: null, error })
	if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
		return fail('Each YAML document must be a mapping')
	}
	const item = definition as Record<string, unknown>
	const manufacturer = typeof item.manufacturer === 'string' ? item.manufacturer.trim() : ''
	const model = typeof item.model === 'string' ? item.model.trim() : ''
	if (!manufacturer || !model) {
		return fail('manufacturer and model are required by NetBox YAML')
	}
	const mfr = getDb()
		.select()
		.from(manufacturers)
		.all()
		.find(
			(row) =>
				row.name.toLowerCase() === manufacturer.toLowerCase() || row.slug === manufacturer,
		)
	if (!mfr) {
		return {
			...fail(`Unknown manufacturer "${manufacturer}"`),
			unknown_manufacturer: manufacturer,
		}
	}
	const height = item.u_height === undefined ? 1 : Number(item.u_height)
	if (!Number.isInteger(height) || height < 0 || height > 60) {
		return fail('u_height must be an integer between 0 and 60')
	}
	let fullDepth = true
	if (item.is_full_depth !== undefined) {
		if (typeof item.is_full_depth === 'boolean') {
			fullDepth = item.is_full_depth
		} else if (typeof item.is_full_depth === 'number') {
			fullDepth = item.is_full_depth !== 0
		} else if (typeof item.is_full_depth === 'string') {
			const s = item.is_full_depth.trim().toLowerCase()
			if (s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === '') {
				fullDepth = true
			} else if (s === 'false' || s === '0' || s === 'no' || s === 'n') {
				fullDepth = false
			} else {
				return fail('is_full_depth must be a boolean (true/false)')
			}
		} else {
			return fail('is_full_depth must be a boolean (true/false)')
		}
	}
	const created = createDeviceType({
		manufacturer_id: mfr.id,
		model,
		u_height: height,
		is_full_depth: fullDepth,
		description: typeof item.description === 'string' ? item.description : undefined,
		comments: typeof item.comments === 'string' ? item.comments : undefined,
	})
	if (Result.isError(created)) {
		return fail(created.error.message)
	}
	for (const [key, defaultKind] of [
		['interfaces', 'ethernet'],
		['console-ports', 'console'],
		['power-ports', 'power'],
	] as const) {
		const ports = item[key]
		if (!Array.isArray(ports)) {
			continue
		}
		for (const component of ports) {
			if (!component || typeof component !== 'object' || Array.isArray(component)) {
				continue
			}
			const port = component as Record<string, unknown>
			const name = typeof port.name === 'string' ? port.name.trim() : ''
			if (!name) {
				continue
			}
			// NetBox interface types may be a list; the first entry wins.
			const type = Array.isArray(port.type) ? port.type[0] : port.type
			const stub = createStub(created.value.id, {
				prefix: name,
				count: 1,
				kind: type === undefined || type === null ? defaultKind : String(type),
				label:
					key === 'interfaces' && typeof port.label === 'string' ? port.label : undefined,
				description: typeof port.description === 'string' ? port.description : undefined,
			})
			if (Result.isError(stub)) {
				return fail(`${key} "${name}": ${stub.error.message}`)
			}
		}
	}
	return { ok: true, id: created.value.id, error: null }
}

/** Devices export: one row per device, slugs for the FK columns. */
export function exportDevicesCsv(scopeTenantId?: number): string {
	const db = getDb()
	const scopeCond = scopeTenantId === undefined ? undefined : eq(devices.tenant_id, scopeTenantId)
	const rows = db
		.select({
			name: devices.name,
			asset_tag: devices.asset_tag,
			type_model: device_types.model,
			site_slug: sites.slug,
			rack_name: racks.name,
			position_u: devices.position_u,
			status: devices.status,
		})
		.from(devices)
		.leftJoin(device_types, eq(devices.device_type_id, device_types.id))
		.leftJoin(sites, eq(devices.site_id, sites.id))
		.leftJoin(racks, eq(devices.rack_id, racks.id))
		.where(scopeCond)
		.orderBy(devices.name)
		.all()
	return toCsv(
		DEVICE_CSV_HEADER,
		rows.map((r) => [
			r.name,
			r.asset_tag,
			r.type_model,
			r.site_slug,
			r.rack_name,
			r.position_u === null ? null : String(r.position_u),
			r.status,
		]),
	)
}

/** Cables export: endpoint device/interface names plus label/kind/status. */
export function exportCablesCsv(scopeTenantId?: number): string {
	const db = getDb()
	// All cables (no 200-row cap); scope filter is an EXISTS on both ends so
	// no peer name from another tenant leaks. Batched iface/device loads keep
	// this O(1) queries instead of O(cables).
	const items = db
		.select()
		.from(cables)
		.where(
			scopeTenantId === undefined
				? undefined
				: and(
						sql`EXISTS (SELECT 1 FROM interfaces AS scope_ia JOIN devices AS scope_da ON scope_da.id = scope_ia.device_id WHERE scope_ia.id = ${cables.a_interface_id} AND scope_da.tenant_id = ${scopeTenantId})`,
						sql`EXISTS (SELECT 1 FROM interfaces AS scope_ib JOIN devices AS scope_db ON scope_db.id = scope_ib.device_id WHERE scope_ib.id = ${cables.b_interface_id} AND scope_db.tenant_id = ${scopeTenantId})`,
					),
		)
		.orderBy(cables.id)
		.all()
	const ifaceIds = [...new Set(items.flatMap((c) => [c.a_interface_id, c.b_interface_id]))]
	const ifacesById = new Map<number, typeof interfaces.$inferSelect>()
	if (ifaceIds.length > 0) {
		for (const row of db
			.select()
			.from(interfaces)
			.where(inArray(interfaces.id, ifaceIds))
			.all()) {
			ifacesById.set(row.id, row)
		}
	}
	const deviceIds = [...new Set([...ifacesById.values()].map((r) => r.device_id))]
	const devicesById = new Map<number, typeof devices.$inferSelect>()
	if (deviceIds.length > 0) {
		for (const row of db.select().from(devices).where(inArray(devices.id, deviceIds)).all()) {
			devicesById.set(row.id, row)
		}
	}
	return toCsv(
		CABLE_CSV_HEADER,
		items.map((cable) => {
			const aIface = ifacesById.get(cable.a_interface_id)
			const bIface = ifacesById.get(cable.b_interface_id)
			return [
				aIface ? (devicesById.get(aIface.device_id)?.name ?? '') : '',
				aIface?.name ?? '',
				bIface ? (devicesById.get(bIface.device_id)?.name ?? '') : '',
				bIface?.name ?? '',
				cable.label,
				cable.kind,
				cable.status,
			]
		}),
	)
}

function importResult(rows: ImportRowResult[]): ImportResponse {
	return {
		created: rows.filter((r) => r.ok).length,
		failed: rows.filter((r) => r.error !== null).length,
		rows,
	}
}

/** Strict scope check: exactly the scope tenant, no shared rows. */
function inScope(tenant: number | null | undefined, scope: number): boolean {
	return tenant !== undefined && tenant !== null && tenant === scope
}

/**
 * Devices import: validates each row with `DeviceImportRowSchema`, resolves
 * slugs to ids, and creates the device (stub expansion included). One bad
 * row fails only itself; the response reports per-row errors.
 *
 * `scopeTenantId` serves scoped editors: rows referencing a site/rack
 * outside the scope (or shared rows they may not claim) fail per-row, and
 * created devices are forced into the scope tenant.
 */
export function importDevicesCsv(
	text: string,
	scopeTenantId?: number,
): Result<ImportResponse, Error> {
	const parsed = parseCsv(text)
	if (Result.isError(parsed)) {
		return Result.err(parsed.error)
	}
	const db = getDb()
	const typeByModel = new Map(
		db
			.select()
			.from(device_types)
			.all()
			.map((r) => [r.model, r.id]),
	)
	const siteBySlug = new Map(
		db
			.select()
			.from(sites)
			.all()
			.map((r) => [r.slug, { id: r.id, tenant_id: r.tenant_id }]),
	)
	const rackByName = new Map(
		db
			.select()
			.from(racks)
			.all()
			.map((r) => [r.name, { id: r.id, tenant_id: r.tenant_id }]),
	)
	const rows: ImportRowResult[] = []
	for (const [index, obj] of rowsToObjects(parsed.value.header, parsed.value.rows).entries()) {
		const rowNumber = index + 2
		const fail = (error: string): void => {
			rows.push({ row: rowNumber, ok: false, id: null, error })
		}
		const validated = v.safeParse(DeviceImportRowSchema, obj)
		if (!validated.success) {
			fail(formatValibotIssues(validated.issues))
			continue
		}
		const input = validated.output
		const typeId = typeByModel.get(input.device_type_model)
		if (!typeId) {
			fail(`Unknown device_type_model "${input.device_type_model}"`)
			continue
		}
		let foundSiteId: number | undefined
		if (input.site_slug) {
			const site = siteBySlug.get(input.site_slug)
			if (!site) {
				fail(`Unknown site_slug "${input.site_slug}"`)
				continue
			}
			foundSiteId = site.id
			if (scopeTenantId !== undefined && !inScope(site.tenant_id, scopeTenantId)) {
				fail(`Site "${input.site_slug}" is outside your tenant scope`)
				continue
			}
		}
		let foundRackId: number | undefined
		if (input.rack_name) {
			const rack = rackByName.get(input.rack_name)
			if (!rack) {
				fail(`Unknown rack_name "${input.rack_name}"`)
				continue
			}
			foundRackId = rack.id
			if (scopeTenantId !== undefined && !inScope(rack.tenant_id, scopeTenantId)) {
				fail(`Rack "${input.rack_name}" is outside your tenant scope`)
				continue
			}
		}
		const created = createDevice({
			device_type_id: typeId,
			name: input.name,
			status: input.status,
			site_id: foundSiteId,
			rack_id: foundRackId,
			position_u: input.position_u,
			asset_tag: input.asset_tag,
			...(scopeTenantId !== undefined ? { tenant_id: scopeTenantId } : {}),
		})
		if (Result.isError(created)) {
			fail(created.error.message)
			continue
		}
		rows.push({ row: rowNumber, ok: true, id: created.value.id, error: null })
	}
	return Result.ok(importResult(rows))
}

/**
 * Cables import: validates each row with `CableImportRowSchema`, resolves
 * device/interface names to ids, and connects the free ports. One bad row
 * fails only itself; the response reports per-row errors.
 *
 * `scopeTenantId` serves scoped editors: rows whose endpoint devices are
 * not both in the scope tenant fail per-row, mirroring the cable write
 * rule in `authz.ts`.
 */
export function importCablesCsv(
	text: string,
	scopeTenantId?: number,
): Result<ImportResponse, Error> {
	const parsed = parseCsv(text)
	if (Result.isError(parsed)) {
		return Result.err(parsed.error)
	}
	const db = getDb()
	const deviceByName = new Map(
		db
			.select()
			.from(devices)
			.all()
			.map((r) => [r.name, { id: r.id, tenant_id: r.tenant_id }]),
	)
	const ifaceByKey = new Map(
		db
			.select()
			.from(interfaces)
			.all()
			.map((r) => [`${r.device_id}:${r.name}`, r.id]),
	)
	const rows: ImportRowResult[] = []
	for (const [index, obj] of rowsToObjects(parsed.value.header, parsed.value.rows).entries()) {
		const rowNumber = index + 2
		const fail = (error: string): void => {
			rows.push({ row: rowNumber, ok: false, id: null, error })
		}
		const validated = v.safeParse(CableImportRowSchema, obj)
		if (!validated.success) {
			fail(formatValibotIssues(validated.issues))
			continue
		}
		const input = validated.output
		const aDev = deviceByName.get(input.a_device)
		if (!aDev) {
			fail(`Unknown a_device "${input.a_device}"`)
			continue
		}
		const bDev = deviceByName.get(input.b_device)
		if (!bDev) {
			fail(`Unknown b_device "${input.b_device}"`)
			continue
		}
		const aIfaceId = ifaceByKey.get(`${aDev.id}:${input.a_interface}`)
		if (!aIfaceId) {
			fail(`Device "${input.a_device}" has no interface "${input.a_interface}"`)
			continue
		}
		const bIfaceId = ifaceByKey.get(`${bDev.id}:${input.b_interface}`)
		if (!bIfaceId) {
			fail(`Device "${input.b_device}" has no interface "${input.b_interface}"`)
			continue
		}
		if (scopeTenantId !== undefined) {
			if (
				!inScope(aDev.tenant_id, scopeTenantId) ||
				!inScope(bDev.tenant_id, scopeTenantId)
			) {
				fail('Cable endpoints are outside your tenant scope')
				continue
			}
		}
		const created = connectCable({
			a_interface_id: aIfaceId,
			b_interface_id: bIfaceId,
			status: input.status,
			kind: input.kind,
			label: input.label,
		})
		if (Result.isError(created)) {
			fail(created.error.message)
			continue
		}
		rows.push({ row: rowNumber, ok: true, id: created.value.id, error: null })
	}
	return Result.ok(importResult(rows))
}
