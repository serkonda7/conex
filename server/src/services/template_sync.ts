import { Result } from 'better-result'
import type {
	ExpandedInterface,
	PortSide,
	TemplateSyncAssignment,
	TemplateSyncChange,
	TemplateSyncPreview,
} from 'shared/src/schemas'
import type { interfaces } from '../schema'

type Port = typeof interfaces.$inferSelect

const keyOf = (port: { side: PortSide | null; name: string }): string =>
	`${port.side ?? ''}:${port.name}`

interface PortDiff {
	/** Port per expanded index; null where the device lacks it. */
	slots: (Port | null)[]
	orphans: Port[]
}

/** The name a port goes by in its template. */
const templateName = (port: Port): string => port.template_name ?? port.name

/** Pairs ports with the expansion on side and name; a linked port wins its template name. */
function matchPorts(expected: ExpandedInterface[], ports: Port[]): PortDiff {
	const linkedLast = [
		...ports.filter((port) => port.template_name === null),
		...ports.filter((port) => port.template_name !== null),
	]
	const byKey = new Map(
		linkedLast.map((port) => [keyOf({ side: port.side, name: templateName(port) }), port]),
	)
	const slots = expected.map((target) => byKey.get(keyOf(target)) ?? null)
	const matched = new Set(slots.map((port) => port?.id))
	return { slots, orphans: ports.filter((port) => !matched.has(port.id)) }
}

const rearLabel = (name: string | undefined, position: number | null): string | null =>
	name === undefined ? null : `${name} / ${position ?? 1}`

/** Fields of a matched port that differ from its expansion. */
function changesOf(
	port: Port,
	target: ExpandedInterface,
	expected: ExpandedInterface[],
	ports: Port[],
): TemplateSyncChange[] {
	const rear = ports.find((p) => p.id === port.rear_port_id)
	const targetRear = target.rear_index === null ? undefined : expected[target.rear_index]
	const rearFrom = rearLabel(rear && templateName(rear), port.rear_port_position)
	const rearTo = rearLabel(targetRear?.name, target.rear_port_position)
	const changes: TemplateSyncChange[] = []
	if (port.kind !== target.kind) {
		changes.push({ field: 'kind', from: port.kind, to: target.kind })
	}
	if (port.positions !== target.positions) {
		changes.push({
			field: 'positions',
			from: String(port.positions),
			to: String(target.positions),
		})
	}
	if (rearFrom !== rearTo) {
		changes.push({ field: 'rear_port', from: rearFrom, to: rearTo })
	}
	return changes
}

/** Whether a device's ports differ from the expansion of its device type. */
export function isOutOfSync(expected: ExpandedInterface[], ports: Port[]): boolean {
	const { slots, orphans } = matchPorts(expected, ports)
	return (
		orphans.length > 0 ||
		expected.some((target, i) => {
			const port = slots[i]
			return !port || changesOf(port, target, expected, ports).length > 0
		})
	)
}

/**
 * The added port each orphan most likely became: orphans pair up in port
 * order with added ports of the same side and kind, which is what renaming
 * a stub produces. Different kinds are never suggested.
 */
function suggestTargets(orphans: Port[], added: ExpandedInterface[]): Map<number, string> {
	const open = [...added]
	const out = new Map<number, string>()
	for (const orphan of orphans) {
		const i = open.findIndex((t) => t.side === orphan.side && t.kind === orphan.kind)
		const target = open[i]
		if (target) {
			out.set(orphan.id, target.name)
			open.splice(i, 1)
		}
	}
	return out
}

/** `placed`: ids of the ports on a floor plan. */
export function buildPreview(
	expected: ExpandedInterface[],
	ports: Port[],
	placed: Set<number>,
): TemplateSyncPreview {
	const { slots, orphans } = matchPorts(expected, ports)
	const added = expected.filter((_, i) => !slots[i])
	const suggestions = suggestTargets(orphans, added)
	const updated: TemplateSyncPreview['updated'] = []
	let unchanged = 0
	expected.forEach((target, i) => {
		const port = slots[i]
		if (!port) {
			return
		}
		const changes = changesOf(port, target, expected, ports)
		if (changes.length === 0) {
			unchanged += 1
		} else {
			updated.push({ interface_id: port.id, name: port.name, side: port.side, changes })
		}
	})
	return {
		unchanged,
		updated,
		orphaned: orphans.map((port) => ({
			interface_id: port.id,
			name: port.name,
			side: port.side,
			kind: port.kind,
			connected: port.connected !== 0,
			located: placed.has(port.id),
			linked: port.template_name !== null,
			suggestion: suggestions.get(port.id) ?? null,
		})),
		added: added.map(({ name, side, kind }) => ({ name, side, kind })),
	}
}

export interface SyncPlan {
	/** Port per expanded index after remapping; null ports are created. */
	slots: (Port | null)[]
	removed: Port[]
	/** Ports keeping a custom name, linked to their slot's template port. */
	linked: Set<number>
}

const STALE = 'The device or its type changed; reopen the preview'

/** A kept front port needs its rear port and slot to survive the sync. */
function checkKeptFront(port: Port, plan: SyncPlan, expected: ExpandedInterface[]): string | null {
	if (port.rear_port_id === null) {
		return null
	}
	if (plan.removed.some((p) => p.id === port.rear_port_id)) {
		return `Front port ${port.name} is kept, so its rear port cannot be removed`
	}
	const i = plan.slots.findIndex((p) => p?.id === port.rear_port_id)
	const positions = expected[i]?.positions
	if (positions !== undefined && (port.rear_port_position ?? 1) > positions) {
		return `Front port ${port.name} uses a position its rear port no longer has`
	}
	return null
}

/**
 * Resolves the decisions on a fresh diff. Every orphan needs exactly one
 * decision, so a preview that went stale is refused instead of guessed at.
 */
export function planSync(
	expected: ExpandedInterface[],
	ports: Port[],
	assignments: TemplateSyncAssignment[],
): Result<SyncPlan, Error> {
	const { slots, orphans } = matchPorts(expected, ports)
	if (
		assignments.length !== orphans.length ||
		orphans.some((port) => !assignments.some((a) => a.interface_id === port.id))
	) {
		return Result.err(new Error(STALE))
	}
	const plan: SyncPlan = {
		slots: [...slots],
		removed: [],
		linked: new Set(slots.flatMap((port) => (port?.template_name ? [port.id] : []))),
	}
	const kept: Port[] = []
	for (const port of orphans) {
		const assignment = assignments.find((a) => a.interface_id === port.id)
		if (assignment?.action === 'keep') {
			kept.push(port)
		} else if (assignment?.action === 'remove') {
			if (port.connected !== 0) {
				return Result.err(
					new Error(`Interface ${port.name} is connected; keep or remap it`),
				)
			}
			plan.removed.push(port)
		} else {
			const key = keyOf({ side: port.side, name: assignment?.target ?? '' })
			const i = expected.findIndex((target) => keyOf(target) === key)
			if (i === -1 || slots[i]) {
				return Result.err(new Error(STALE))
			}
			if (plan.slots[i]) {
				return Result.err(new Error(`Several ports are mapped to ${assignment?.target}`))
			}
			plan.slots[i] = port
			if (assignment?.action === 'link') {
				plan.linked.add(port.id)
			}
		}
	}
	for (const port of kept) {
		const problem = checkKeptFront(port, plan, expected)
		if (problem !== null) {
			return Result.err(new Error(problem))
		}
	}
	return Result.ok(plan)
}
