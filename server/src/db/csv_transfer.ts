import { Result } from 'better-result'
import { and, eq } from 'drizzle-orm'
import {
	CableImportRowSchema,
	DeviceImportRowSchema,
	DeviceTypeImportRowSchema,
	type ImportResponse,
	type ImportRowResult,
} from 'shared/src/schemas'
import * as v from 'valibot'
import { device_types, devices, interfaces, manufacturers, racks, sites } from '../schema'
import { parseCsv, rowsToObjects, toCsv } from '../util/csv'
import { formatValibotIssues } from '../util/valibot'
import { connectCable, listCables } from './cables'
import { getDb } from './connection'
import { createDevice } from './devices'
import { createDeviceType } from './templates'

export const DEVICE_CSV_HEADER = [
	'name',
	'asset_tag',
	'device_type_slug',
	'site_slug',
	'rack_slug',
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
	'slug',
	'u_height',
	'form_factor',
	'width',
	'description',
]

function manufacturerId(slug: string): number | undefined {
	return getDb().select().from(manufacturers).where(eq(manufacturers.slug, slug)).get()?.id
}

/** Device-type export: one row per type, manufacturer as slug for re-import. */
export function exportDeviceTypesCsv(): string {
	const db = getDb()
	const rows = db
		.select({
			manufacturer_slug: manufacturers.slug,
			model: device_types.model,
			slug: device_types.slug,
			u_height: device_types.u_height,
			form_factor: device_types.form_factor,
			width: device_types.width,
			description: device_types.description,
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
			r.slug,
			String(r.u_height),
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
		const mfrId = manufacturerId(input.manufacturer_slug)
		if (!mfrId) {
			fail(`Unknown manufacturer_slug "${input.manufacturer_slug}"`)
			continue
		}
		const created = createDeviceType({
			manufacturer_id: mfrId,
			model: input.model,
			slug: input.slug,
			u_height: input.u_height ?? 1,
			form_factor: input.form_factor,
			width: (input.width ?? undefined) as 10 | 19 | 23 | undefined,
			description: input.description,
		})
		if (Result.isError(created)) {
			fail(created.error.message)
			continue
		}
		rows.push({ row: rowNumber, ok: true, id: created.value.id, error: null })
	}
	return Result.ok(importResult(rows))
}

/** Devices export: one row per device, slugs for the FK columns. */
export function exportDevicesCsv(scopeTenantId?: number): string {
	const db = getDb()
	const scopeCond = scopeTenantId === undefined ? undefined : eq(devices.tenant_id, scopeTenantId)
	const rows = db
		.select({
			name: devices.name,
			asset_tag: devices.asset_tag,
			type_slug: device_types.slug,
			site_slug: sites.slug,
			rack_slug: racks.slug,
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
			r.type_slug,
			r.site_slug,
			r.rack_slug,
			r.position_u === null ? null : String(r.position_u),
			r.status,
		]),
	)
}

/** Cables export: endpoint device/interface names plus label/kind/status. */
export function exportCablesCsv(scopeTenantId?: number): string {
	const db = getDb()
	const page = listCables({ search: '', page: 1, limit: 200, scopeTenantId })
	const dataRows: (string | null)[][] = []
	for (const cable of page.items) {
		const aIface = db
			.select()
			.from(interfaces)
			.where(eq(interfaces.id, cable.a_interface_id))
			.get()
		const bIface = db
			.select()
			.from(interfaces)
			.where(eq(interfaces.id, cable.b_interface_id))
			.get()
		const aDev = aIface
			? db.select().from(devices).where(eq(devices.id, aIface.device_id)).get()
			: undefined
		const bDev = bIface
			? db.select().from(devices).where(eq(devices.id, bIface.device_id)).get()
			: undefined
		dataRows.push([
			aDev?.name ?? '',
			aIface?.name ?? '',
			bDev?.name ?? '',
			bIface?.name ?? '',
			cable.label,
			cable.kind,
			cable.status,
		])
	}
	return toCsv(CABLE_CSV_HEADER, dataRows)
}

function deviceTypeId(slug: string): number | undefined {
	return getDb().select().from(device_types).where(eq(device_types.slug, slug)).get()?.id
}

function siteId(slug: string): number | undefined {
	return getDb().select().from(sites).where(eq(sites.slug, slug)).get()?.id
}

function rackId(slug: string): number | undefined {
	return getDb().select().from(racks).where(eq(racks.slug, slug)).get()?.id
}

function deviceByName(name: string): number | undefined {
	return getDb().select().from(devices).where(eq(devices.name, name)).get()?.id
}

/** Tenant of a site/rack row; `undefined` when the row is missing. */
function siteTenant(id: number): number | null | undefined {
	return getDb().select().from(sites).where(eq(sites.id, id)).get()?.tenant_id
}

function rackTenant(id: number): number | null | undefined {
	return getDb().select().from(racks).where(eq(racks.id, id)).get()?.tenant_id
}

/** Scope readability (strict): exactly the scope tenant, no shared rows. */
function scopeReadable(tenant: number | null | undefined, scope: number): boolean {
	return tenant !== undefined && tenant !== null && tenant === scope
}

/** Tenant of a device row; `undefined` when the row is missing. */
function deviceTenant(id: number): number | null | undefined {
	return getDb().select().from(devices).where(eq(devices.id, id)).get()?.tenant_id
}

function ifaceId(deviceId: number, name: string): number | undefined {
	return getDb()
		.select()
		.from(interfaces)
		.where(and(eq(interfaces.device_id, deviceId), eq(interfaces.name, name)))
		.get()?.id
}

function importResult(rows: ImportRowResult[]): ImportResponse {
	return {
		created: rows.filter((r) => r.ok).length,
		failed: rows.filter((r) => !r.ok).length,
		rows,
	}
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
		const typeId = deviceTypeId(input.device_type_slug)
		if (!typeId) {
			fail(`Unknown device_type_slug "${input.device_type_slug}"`)
			continue
		}
		let foundSiteId: number | undefined
		if (input.site_slug) {
			foundSiteId = siteId(input.site_slug)
			if (!foundSiteId) {
				fail(`Unknown site_slug "${input.site_slug}"`)
				continue
			}
			if (
				scopeTenantId !== undefined &&
				!scopeReadable(siteTenant(foundSiteId), scopeTenantId)
			) {
				fail(`Site "${input.site_slug}" is outside your tenant scope`)
				continue
			}
		}
		let foundRackId: number | undefined
		if (input.rack_slug) {
			foundRackId = rackId(input.rack_slug)
			if (!foundRackId) {
				fail(`Unknown rack_slug "${input.rack_slug}"`)
				continue
			}
			if (
				scopeTenantId !== undefined &&
				!scopeReadable(rackTenant(foundRackId), scopeTenantId)
			) {
				fail(`Rack "${input.rack_slug}" is outside your tenant scope`)
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
		const aDevId = deviceByName(input.a_device)
		if (!aDevId) {
			fail(`Unknown a_device "${input.a_device}"`)
			continue
		}
		const bDevId = deviceByName(input.b_device)
		if (!bDevId) {
			fail(`Unknown b_device "${input.b_device}"`)
			continue
		}
		const aIfaceId = ifaceId(aDevId, input.a_interface)
		if (!aIfaceId) {
			fail(`Device "${input.a_device}" has no interface "${input.a_interface}"`)
			continue
		}
		const bIfaceId = ifaceId(bDevId, input.b_interface)
		if (!bIfaceId) {
			fail(`Device "${input.b_device}" has no interface "${input.b_interface}"`)
			continue
		}
		if (scopeTenantId !== undefined) {
			const tenantA = deviceTenant(aDevId)
			const tenantB = deviceTenant(bDevId)
			if (!scopeReadable(tenantA, scopeTenantId) || !scopeReadable(tenantB, scopeTenantId)) {
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
