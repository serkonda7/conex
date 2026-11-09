import * as v from 'valibot'
import {
	DEVICE_TYPE_DESCRIPTION_MAX_LENGTH,
	MAX_POWER_DRAW,
	POE_MODES,
	POE_TYPES,
	PORT_SIDES,
} from './constants'

export const NameSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100))

/** Company website: a full http(s) URL or a bare host like `acme.de`. */
export const WebsiteSchema = v.pipe(
	v.string(),
	v.trim(),
	v.maxLength(200),
	v.regex(/^(https?:\/\/)?[^\s/:]+\.[^\s/:]+(:\d+)?(\/\S*)?$/i, 'Must be a website address'),
)

/** Calendar date as `YYYY-MM-DD`; `isoDate` alone lets dates like Feb 30 through. */
export const CalendarDateSchema = v.pipe(
	v.string(),
	v.trim(),
	v.isoDate(),
	v.check((value) => {
		const date = new Date(value)
		return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
	}, 'Invalid calendar date'),
)

// biome-ignore lint/nursery/useExplicitType: valibot schema inference must stay unannotated
// biome-ignore lint/nursery/useExplicitReturnType: valibot schema inference must stay unannotated
export function looseBoolean(emptyAsTrue: boolean) {
	return v.pipe(
		v.union([v.string(), v.number(), v.boolean()]),
		v.transform((raw): unknown => {
			if (typeof raw === 'boolean') {
				return raw
			}
			if (typeof raw === 'number') {
				return raw !== 0
			}
			const s = raw.trim().toLowerCase()
			if (
				s === 'true' ||
				s === '1' ||
				s === 'yes' ||
				s === 'y' ||
				(emptyAsTrue && s === '')
			) {
				return true
			}
			if (s === 'false' || s === '0' || s === 'no' || s === 'n') {
				return false
			}
			return raw
		}),
		v.boolean('Must be a boolean (true/false)'),
	)
}

export const PortSideSchema = v.picklist(PORT_SIDES)

/** Positions of one rear port: 1 for a plain outlet, N for a trunk (MPO). */
export const PortPositionsSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1024))

/** Interface kind label (e.g. `ethernet`, `fiber`, `power`, `usb-c`, `hdmi`). */
export const InterfaceKindSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(50))

/** Port count of one stub row: at least 1. */
export const StubCountSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1024))

/**
 * Rack units a device type consumes on mount: 0-60 U. A zero-height device
 * cannot be mounted at a rack position. Shelves live in their own table.
 */
export const DeviceHeightSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(60))

export const DeviceTypeDescriptionSchema = v.pipe(
	v.string(),
	v.trim(),
	v.maxLength(DEVICE_TYPE_DESCRIPTION_MAX_LENGTH),
)

/** Power fields of a stub: `maximum_draw` on power inputs, PoE on network interfaces. */
export const StubPowerEntries = {
	maximum_draw: v.optional(
		v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_POWER_DRAW))),
		undefined,
	),
	poe_mode: v.optional(v.nullable(v.picklist(POE_MODES)), undefined),
	poe_type: v.optional(v.nullable(v.picklist(POE_TYPES)), undefined),
}

/** Stub fields besides the name and the rear stub a front stub maps onto. */
// biome-ignore lint/nursery/useExplicitType: valibot schema inference must stay unannotated
export const StubFieldEntries = {
	count: v.optional(StubCountSchema, 1),
	kind: v.optional(InterfaceKindSchema, 'ethernet'),
	side: v.optional(v.nullable(PortSideSchema), undefined),
	positions: v.optional(PortPositionsSchema, undefined),
	rear_position: v.optional(PortPositionsSchema, undefined),
	...StubPowerEntries,
}

/**
 * One stub of an imported definition: the limits of the stub API, but vendor
 * names keep any character.
 */
export const ImportedStubSchema = v.strictObject({
	prefix: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(50)),
	...StubFieldEntries,
})

export type ImportedStub = v.InferOutput<typeof ImportedStubSchema>

/**
 * Loose boolean for CSV cells: true/false, 1/0, yes/no (case-insensitive),
 * with an empty cell defaulting to true (full depth). Unknown text falls
 * through so the trailing `v.boolean()` fails validation loudly.
 */
const LooseBooleanSchema = looseBoolean(true)

/**
 * One NetBox device-type YAML definition. `manufacturer` resolves to an id
 * server-side; `u_height` may arrive as text and coerces through Number.
 * Ports and other NetBox keys pass through untouched for the importer.
 */
export const DeviceTypeYamlSchema = v.looseObject({
	manufacturer: NameSchema,
	model: NameSchema,
	u_height: v.optional(
		v.pipe(
			v.union([v.string(), v.number()]),
			v.transform((raw) => (typeof raw === 'number' ? raw : Number(raw))),
			DeviceHeightSchema,
		),
		1,
	),
	is_full_depth: v.optional(LooseBooleanSchema, true),
	/** conex extension: device role name preselected for devices of this type. */
	default_device_role: v.nullish(NameSchema, undefined),
	/** conex extension: manufacturer article/part number. */
	part_number: v.nullish(v.pipe(v.string(), v.trim(), v.maxLength(100)), undefined),
	/** conex extension: link to the manufacturer's spec/datasheet. */
	spec_url: v.nullish(WebsiteSchema, undefined),
	/** conex extension: last day the manufacturer supports the model. */
	eol_date: v.nullish(CalendarDateSchema, undefined),
	description: v.nullish(DeviceTypeDescriptionSchema, undefined),
	comments: v.nullish(v.pipe(v.string(), v.trim(), v.maxLength(2000)), undefined),
})

export type DeviceTypeYaml = v.InferOutput<typeof DeviceTypeYamlSchema>

/**
 * Turns a single valibot issue into a message a caller can act on.
 * The default texts for a missing or unexpected key read like internals
 * ("Invalid key: Expected never but received ..."), so those two get a
 * dedicated wording.
 */
export function formatValibotIssue(issue: v.BaseIssue<unknown>): string {
	const path = v.getDotPath(issue)
	if (!path) {
		return issue.message
	}

	if (issue.kind === 'schema' && issue.received === 'undefined') {
		return `Field "${path}" is required`
	}
	if (issue.type === 'strict_object') {
		return `Field "${path}" is not allowed`
	}

	return `${path}: ${issue.message}`
}

/** Joins all issues of a rejected payload into one sentence. */
export function formatValibotIssues(
	issues: readonly [v.BaseIssue<unknown>, ...v.BaseIssue<unknown>[]],
): string {
	return issues.map(formatValibotIssue).join('; ')
}
