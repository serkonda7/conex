import { Result } from 'better-result'
import { createMemo, type JSX } from 'solid-js'
import { type EmployeeRow, fetch_all_employees, fetch_employee } from '../../api/employees'
import { type FormOption, row_options, SelectField } from '../../components/form'
import { t } from '../../i18n'
import { createRowsFor, type ErrorSink } from '../../lib/resource'

/** Active employees of `tenant`: the ones offered for a new assignment. */
const load_active = (tenant: number): Promise<Result<EmployeeRow[], Error>> =>
	fetch_all_employees({ tenant, active: 'true' })

/** The employees with `ids`, e.g. inactive ones that are still assigned. */
async function load_by_ids(ids: number[]): Promise<Result<EmployeeRow[], Error>> {
	const results = await Promise.all(ids.map((id) => fetch_employee(id)))
	return Result.all(results)
}

/**
 * Options of an employee assignment: the tenant's active employees, plus
 * the assigned ones among `selected` that are inactive, marked as such, so
 * saving the form keeps them.
 */
export function createEmployeeOptions(
	tenantId: () => number | null,
	selected: () => number[],
	onError: ErrorSink,
): { options: () => FormOption[]; loading: () => boolean } {
	const [active] = createRowsFor(tenantId, load_active, onError)
	const missing = createMemo((): number[] | null => {
		if (active.loading) {
			return null
		}
		const known = new Set((active() ?? []).map((row) => row.id))
		const ids = selected().filter((id) => !known.has(id))
		return ids.length === 0 ? null : ids
	})
	const [inactive] = createRowsFor(missing, load_by_ids, onError)
	const options = (): FormOption[] => {
		const tenant = tenantId()
		if (tenant === null) {
			return []
		}
		const member = (row: EmployeeRow): boolean => row.tenant_ids.includes(tenant)
		return [
			...row_options((active() ?? []).filter(member)),
			...(inactive() ?? [])
				.filter((row) => member(row) && selected().includes(row.id))
				.map((row) => ({ value: row.id, label: row.name, detail: t('employee.inactive') })),
		]
	}
	return { options, loading: () => active.loading }
}

/** Only contacts of the device's tenant can be assigned. */
export function EmployeeAssignmentField(props: {
	id: string
	tenantId: number | null
	value: string
	onChange: (value: string) => void
	onError: ErrorSink
	emptyLabel?: string
}): JSX.Element {
	const employees = createEmployeeOptions(
		() => props.tenantId,
		() => (props.value === '' ? [] : [Number(props.value)]),
		props.onError,
	)
	return (
		<SelectField
			id={props.id}
			label={t('device.assignedEmployee')}
			value={props.value}
			onChange={props.onChange}
			options={employees.options()}
			emptyLabel={props.emptyLabel ?? t('device.noEmployee')}
			disabled={props.tenantId === null || employees.loading()}
		/>
	)
}
