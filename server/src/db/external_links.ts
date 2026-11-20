/**
 * Cleanup of external-integration links when their (polymorphic) owner is
 * deleted: `entity_id` has no FK, so each service removes its own links.
 */
import { and, eq } from 'drizzle-orm'
import type { LinkEntityType } from 'shared/src/schemas'
import { external_links } from '../schema'
import { getDb } from './connection'

/** Removes every external link of one entity in the current transaction. */
export async function deleteExternalLinks(entityType: LinkEntityType, id: number): Promise<void> {
	await getDb()
		.delete(external_links)
		.where(and(eq(external_links.entity_type, entityType), eq(external_links.entity_id, id)))
}
