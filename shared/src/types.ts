// Request payload types live in `schemas.ts`, derived from their runtime schema.
// They are re-exported here so importers keep a single entry point for types.
export type * from './schemas'

/** Paginated list response shape returned by every `GET` list endpoint. */
export interface Page<T> {
	items: T[]
	total: number
	page: number
	limit: number
}

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
