/**
 * Naming of a priority. The external system (TANSS) tags a ticket with the
 * label of its priority, which carries the rank: `P1 - Critical`. The same
 * label is shown in the UI, so client and server always name a priority the
 * same way.
 *
 * Shared because the tag lookup in the external system and the label in the
 * client have to agree, and a drifting spelling would leave tickets
 * untagged.
 */

/** A priority with its rank (1 is the most urgent). */
export type PriorityRef = { rank: number; name: string }

/** `P<rank> - <name>`, e.g. `P1 - Critical`. */
export function priorityLabel(priority: PriorityRef): string {
	return `P${priority.rank} - ${priority.name}`
}
