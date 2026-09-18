// Request payload types live in `schemas.ts`, derived from their runtime schema.
// They are re-exported here so importers keep a single entry point for types.
export type {
	ListQuery,
	LocationCreate,
	LocationListQuery,
	LocationUpdate,
	Login,
	SiteCreate,
	SiteListQuery,
	SiteUpdate,
	TenantCreate,
	TenantGroupCreate,
	TenantGroupListQuery,
	TenantGroupUpdate,
	TenantListQuery,
	TenantUpdate,
} from './schemas'

/** Health response shape returned by `GET /health`. */
export interface HealthInfo {
	status: 'ok'
	version: string
}

/** JSX helper type for onInput handlers */
export type InputEventAndTarget = InputEvent & {
	currentTarget: HTMLInputElement
	target: HTMLInputElement
}

/** JSX helper type for onClick handlers */
export type MouseEventAndTarget = MouseEvent & {
	currentTarget: HTMLButtonElement
	target: Element
}
