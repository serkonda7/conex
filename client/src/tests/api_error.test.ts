import { describe, expect, test } from 'bun:test'
import { read_api_error } from '../util/api_error'

function fakeResponse(payload: unknown): {
	ok: boolean
	status: number
	json: () => Promise<unknown>
} {
	return {
		ok: false,
		status: 400,
		json: async () => payload,
	}
}

describe('read_api_error', () => {
	test('reads the { error } field', async () => {
		const msg = await read_api_error(fakeResponse({ error: 'boom' }), 'fallback')
		expect(msg).toBe('boom')
	})

	test('falls back when the body has no error field', async () => {
		const msg = await read_api_error(fakeResponse({ other: 1 }), 'fallback')
		expect(msg).toBe('fallback')
	})

	test('falls back when json parsing fails', async () => {
		const res = {
			ok: false,
			status: 500,
			json: async (): Promise<unknown> => {
				throw new Error('no json')
			},
		}
		const msg = await read_api_error(res, 'fallback')
		expect(msg).toBe('fallback')
	})
})
