/**
 * Auto-fill helper: "München Büro" → "muenchen-buero" (matches SlugSchema).
 *
 * Shared because the tenant, site, and site-group create forms all auto-fill
 * the slug from the name and must stay identical.
 */
export function slugify(raw: string): string {
	return raw
		.toLowerCase()
		.trim()
		.replace(/ä/g, 'ae')
		.replace(/ö/g, 'oe')
		.replace(/ü/g, 'ue')
		.replace(/ß/g, 'ss')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-')
		.slice(0, 100)
}
