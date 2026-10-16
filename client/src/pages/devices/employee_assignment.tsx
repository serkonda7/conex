import type { JSX } from 'solid-js'
import { fetch_all_employees } from '../../api/employees'
import { row_options, SelectField } from '../../components/form'
import { t } from '../../i18n'
import { createRowsFor, type ErrorSink } from '../../lib/resource'

/** Only contacts of the device's tenant can be assigned. */
export function EmployeeAssignmentField(props: {
	id: string
	tenantId: number | null
	value: string
	onChange: (value: string) => void
	onError: ErrorSink
	emptyLabel?: string
}): JSX.Element {
	const [employees] = createRowsFor(
		() => props.tenantId,
		(tenant: number) => fetch_all_employees({ tenant }),
		props.onError,
	)
	return (
		<SelectField
			id={props.id}
			label={t('device.assignedEmployee')}
			value={props.value}
			onChange={props.onChange}
			options={row_options(
				(employees() ?? []).filter((row) => row.tenant_id === props.tenantId),
			)}
			emptyLabel={props.emptyLabel ?? t('device.noEmployee')}
			disabled={props.tenantId === null || employees.loading}
			hint={props.tenantId === null ? t('device.employeeTenantHint') : undefined}
		/>
	)
}
