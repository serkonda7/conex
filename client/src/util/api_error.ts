export type ApiResponse = Pick<Response, 'ok' | 'status' | 'json'>

export async function read_api_error(response: ApiResponse, fallback_msg: string): Promise<string> {
	const data = await response.json().catch(() => null)

	if (typeof data === 'object' && data && 'error' in data) {
		return String((data as { error: unknown }).error)
	}

	return fallback_msg
}
