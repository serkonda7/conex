import { IconChevronDown, IconChevronRight } from '@tabler/icons-solidjs'
import { createSignal, type JSX } from 'solid-js'

/**
 * Table rows of `units` (each one or more rows, the first row's `keyOf`
 * naming the unit): runs of two or more consecutive units that are
 * `collapsible` turn into the row `summary` makes of them, followed by their
 * rows when one of their units is in `expanded`.
 */
export function collapseRuns<Row, Summary>(
	units: Row[][],
	keyOf: (row: Row) => string,
	collapsible: (unit: Row[]) => boolean,
	expanded: ReadonlySet<string>,
	summary: (run: Row[][], keys: string[], open: boolean) => Summary,
): (Row | Summary)[] {
	const out: (Row | Summary)[] = []
	let run: Row[][] = []
	const flush = (): void => {
		if (run.length > 1) {
			const keys = run.map((unit) => (unit[0] ? keyOf(unit[0]) : ''))
			const open = keys.some((key) => expanded.has(key))
			out.push(summary(run, keys, open))
			if (open) {
				out.push(...run.flat())
			}
		} else {
			out.push(...run.flat())
		}
		run = []
	}
	for (const unit of units) {
		if (collapsible(unit)) {
			run.push(unit)
		} else {
			flush()
			out.push(...unit)
		}
	}
	flush()
	return out
}

/**
 * The expanded units of collapsed runs and the toggle of a run (by its unit
 * keys); a split run stays expanded.
 */
export function useExpandedRuns(): {
	expanded: () => ReadonlySet<string>
	toggle: (run: { units: string[]; open: boolean }) => void
} {
	const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
	const toggle = (run: { units: string[]; open: boolean }): void => {
		const next = new Set(expanded())
		for (const key of run.units) {
			if (run.open) {
				next.delete(key)
			} else {
				next.add(key)
			}
		}
		setExpanded(next)
	}
	return { expanded, toggle }
}

/** The `#` cell of a run's summary row: chevron and `range`, toggling the run. */
export function RunToggle(props: {
	open: boolean
	range: string
	/** Accessible name and tooltip. */
	label: string
	onToggle: () => void
}): JSX.Element {
	return (
		<button
			type="button"
			class="panel-run-toggle"
			aria-expanded={props.open}
			aria-label={props.label}
			title={props.label}
			onClick={(): void => props.onToggle()}
		>
			{props.open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
			<span>{props.range}</span>
		</button>
	)
}
