import { describe, expect, test } from 'bun:test'
import { createApp } from './index'

describe('health', () => {
	test('GET /health returns ok', async () => {
		const app = createApp()
		const res = await app.request('/health')
		expect(res.status).toBe(200)
		const body = (await res.json()) as { status: string; version: string }
		expect(body.status).toBe('ok')
		expect(typeof body.version).toBe('string')
	})

	test('unknown routes return 404', async () => {
		const app = createApp()
		const res = await app.request('/nope')
		expect(res.status).toBe(404)
	})
})
