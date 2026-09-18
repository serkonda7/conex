// Request payload types live in `schemas.ts`, derived from their runtime schema.
// They are re-exported here so importers keep a single entry point for types.
export type {
	DeviceCreate,
	DeviceListQuery,
	DeviceMove,
	DeviceStatus,
	DeviceUpdate,
	ElevationResponse,
	ElevationShelfRef,
	ElevationUnit,
	InterfaceCreate,
	InterfaceListQuery,
	InterfaceUpdate,
	ListQuery,
	LocationCreate,
	LocationListQuery,
	LocationUpdate,
	Login,
	RackCreate,
	RackListQuery,
	RackStatus,
	RackUpdate,
	Setup,
	ShelfCreate,
	ShelfListQuery,
	ShelfUpdate,
	SiteCreate,
	SiteListQuery,
	SiteUpdate,
	TenantCreate,
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
