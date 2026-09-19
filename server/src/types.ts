export interface User {
	id: number
	email: string
	password_hash: string | null
	provider: string
	provider_id: string | null
}
