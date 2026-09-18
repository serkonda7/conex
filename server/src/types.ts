export interface User {
	id: string
	email: string
	password_hash: string | null
	provider: string
	provider_id: string | null
}
