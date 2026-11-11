import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { type Context, Hono } from 'hono'
import { M365ConsentCallbackQuerySchema } from 'shared/src/schemas'
import { completeConsent } from '../integrations/m365/consent'
import { ip_rate_limit } from '../middleware/rate_limit'

function escapeHtml(raw: string): string {
	return raw.replace(
		/[&<>"']/g,
		(ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
	)
}

/**
 * Plain page for the customer's admin, who has no conex account (so no SPA
 * route). Bilingual, like the e-mails they get from the MSP.
 */
function page(c: Context, ok: boolean, detail: string | null, status: 200 | 400): Response {
	const [de, en] = ok
		? [
				'Zustimmung erteilt. conex kann jetzt Ihr Microsoft-365-Verzeichnis lesen. Sie können dieses Fenster schließen.',
				'Consent granted. conex can now read your Microsoft 365 directory. You can close this window.',
			]
		: [
				'Die Zustimmung konnte nicht bestätigt werden. Bitte wenden Sie sich an Ihren IT-Dienstleister.',
				'Consent could not be confirmed. Please contact your IT service provider.',
			]
	const body = `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>conex · Microsoft 365</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.5}code{word-break:break-all}</style>
</head>
<body>
<h1>${ok ? '✓' : '✗'} Microsoft 365</h1>
<p>${escapeHtml(de)}</p>
<p lang="en">${escapeHtml(en)}</p>
${detail ? `<p><code>${escapeHtml(detail)}</code></p>` : ''}
</body>
</html>`
	return c.html(body, status)
}

/**
 * `GET /integrations/m365/consent` — public redirect target of the admin
 * consent link. Only a valid signed `state` is accepted, and consent counts
 * only once conex itself read the tenant's `/organization` (see
 * `integrations/m365/consent.ts`). Rate-limited per IP.
 */
export const m365ConsentApp = new Hono().get(
	'/',
	ip_rate_limit(20, 300),
	vValidator('query', M365ConsentCallbackQuerySchema, (result, c) =>
		result.success ? undefined : page(c, false, 'Invalid request', 400),
	),
	async (c) => {
		const query = c.req.valid('query')
		if (query.error) {
			return page(c, false, query.error_description?.split(/\r?\n/)[0] ?? query.error, 400)
		}
		if (!query.state || !query.tenant) {
			return page(c, false, 'Missing state or tenant', 400)
		}
		const res = await completeConsent(query.state, query.tenant)
		if (Result.isError(res)) {
			return page(c, false, res.error.message, 400)
		}
		return page(c, true, null, 200)
	},
)
