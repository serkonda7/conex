import type { PortSide } from 'shared/src/schemas'
import type { JSX } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import type { DataTableProps } from '../../components/data_table'
import { t } from '../../i18n'
import { portKindLabel } from '../../i18n/labels'
import { portKindIcon } from '../../lib/icons'
import { ItemIcon } from './add_component'
import { COMPONENT_CLASSES, componentClassOf } from './components'

/** Component groups with more rows than this start collapsed. */
const COMPONENT_GROUP_OPEN_ROWS = 16

/** Port kind with its glyph; the slot stays empty without one, so labels align. */
export function ComponentKind(props: { kind: string }): JSX.Element {
	return (
		<span class="component-kind">
			<span class="component-kind-icon" aria-hidden="true">
				<Dynamic component={portKindIcon(props.kind)} size={18} />
			</span>
			{portKindLabel(props.kind)}
		</span>
	)
}

/**
 * DataTable props that group stubs or ports by component class, in class
 * order, with the class glyph, name and `count` in the heading. Large groups
 * start collapsed.
 */
export function componentGroups<Row extends { kind: string; side: PortSide | null }>(
	count: (rows: Row[]) => number = (rows: Row[]): number => rows.length,
): Pick<DataTableProps<Row>, 'groupBy' | 'groupOrder' | 'groupLabel' | 'defaultGroupOpen'> {
	return {
		groupBy: componentClassOf,
		groupOrder: COMPONENT_CLASSES.map((info) => info.key),
		groupLabel: (key: string, rows: Row[]): JSX.Element => {
			const info = COMPONENT_CLASSES.find((c) => c.key === key)
			return (
				<>
					{info ? <ItemIcon icon={info.icon} /> : null}
					{info ? t(info.label) : key} <span class="text-muted">{count(rows)}</span>
				</>
			)
		},
		defaultGroupOpen: (_key: string, rows: Row[]): boolean =>
			rows.length <= COMPONENT_GROUP_OPEN_ROWS,
	}
}
