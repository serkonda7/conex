/**
 * Runtime contracts for everything a client may send to the API.
 *
 * The TypeScript types are derived from these schemas instead of being written
 * by hand, so the runtime check and the compile-time type cannot drift apart.
 *
 * P0 placeholder: only auth + shared list contracts exist. Domain schemas
 * (tenants, sites, racks, devices, cables) are added in P1-P5.
 */
import * as v from 'valibot'

// Local-login credentials. strictObject so unknown keys fail loudly instead
// of being stripped; the route validator reports them through the shared
// onValidationError hook.
export const LoginSchema = v.strictObject({
	email: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(320)),
	password: v.pipe(v.string(), v.minLength(1), v.maxLength(1024)),
})

export type Login = v.InferInput<typeof LoginSchema>

// Shared list-query contract (?search=&page=&limit=) used by every P1+
// list endpoint. Defaults keep callers from re-declaring pagination math.
export const ListQuerySchema = v.strictObject({
	search: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), ''),
	page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
	limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
})

export type ListQuery = v.InferInput<typeof ListQuerySchema>
