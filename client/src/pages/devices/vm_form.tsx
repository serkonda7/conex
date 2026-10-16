import { Result } from 'better-result'
import { createEffect, createSignal, type JSX, Show } from 'solid-js'
import { fetch_device_roles } from '../../api/device_roles'
import { type DeviceRow, fetch_device } from '../../api/devices'
import { fetch_tenants } from '../../api/tenancy'
import {
	create_virtual_machine,
	fetch_virtual_machine,
	update_virtual_machine,
	type VirtualMachineRow,
} from '../../api/virtual_machines'
import {
	DescriptionField,
	Field,
	FormPage,
	FormSection,
	Hint,
	NameField,
	row_options,
	SelectField,
} from '../../components/form'
import { ObjectSelector } from '../../components/object_selector'
import { t, tp } from '../../i18n'
import {
	type FormValues,
	id_value,
	is_add_another_submit,
	submit_form,
	text,
	useEntityForm,
} from '../../lib/form'
import { createRecord, createRows } from '../../lib/resource'
import { parseId, queryParam, useFormReturnRoute } from '../../lib/router'
import { contextTenantId, useTenantDefault } from '../../lib/tenant_context'
import { deviceRoleOptions } from '../device-roles/options'
import { useDeviceSearch } from './device_search'
import { EmployeeAssignmentField } from './employee_assignment'

/**
 * Host device of a VM: picked with the device search (limited to devices
 * whose role can host VMs), cleared for a cloud VM.
 */
function HostField(props: {
	id: string
	host: DeviceRow | null | undefined
	hostId: number | null
	canHost: (device: DeviceRow) => boolean
	onChange: (host: DeviceRow | null) => void
}): JSX.Element {
	const [selecting, setSelecting] = createSignal(false)
	const deviceSearch = useDeviceSearch()
	const loadHosts = async (search: string): ReturnType<typeof deviceSearch.load> => {
		const res = await deviceSearch.load(search)
		return Result.isError(res) ? res : Result.ok(res.value.filter(props.canHost))
	}
	return (
		<Field
			label={t('vm.host')}
			for={props.id}
			hint={
				<Show when={props.hostId === null}>
					<Hint>{t('vm.hostHint')}</Hint>
				</Show>
			}
		>
			<div class="vm-host-row">
				<input
					id={props.id}
					value={props.hostId === null ? t('vm.noHost') : (props.host?.name ?? '')}
					disabled
				/>
				<button type="button" onClick={() => setSelecting(true)}>
					{t('vm.selectHost')}
				</button>
				<Show when={props.hostId !== null}>
					<button type="button" onClick={() => props.onChange(null)}>
						{t('vm.clearHost')}
					</button>
				</Show>
			</div>
			<Show when={selecting()}>
				<ObjectSelector
					label={t('vm.selectHostTitle')}
					{...deviceSearch}
					load={loadHosts}
					on_select={(device: DeviceRow) => {
						setSelecting(false)
						props.onChange(device)
					}}
					on_close={() => setSelecting(false)}
				/>
			</Show>
		</Field>
	)
}

/**
 * Virtual machine create (`id` omitted) or edit form. A hosted VM has its
 * host's tenant, so the tenant select only shows without a host. Create
 * takes `?host=<id>` (from the host's detail page) and `?clone=<id>`.
 */
function VirtualMachineForm(props: { id?: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [roleId, setRoleId] = createSignal('')
	const [hostId, setHostId] = createSignal<number | null>(parseId(queryParam('host')))
	const [employeeId, setEmployeeId] = createSignal('')
	const tenant = useTenantDefault(
		() => null,
		() => true,
	)
	const form = useEntityForm({
		id: props.id,
		load: fetch_virtual_machine,
		fill: (row: VirtualMachineRow) => {
			fillFrom(row)
			setName(row.name)
			setEmployeeId(id_value(row.employee_id))
		},
	})
	const prefix = form.editing ? 'vm-edit' : 'vm'
	const [host] = createRecord(hostId, fetch_device, form.setError)
	const [roles, { refetch: refetchRoles }] = createRows(fetch_device_roles, form.setError)
	const [tenants] = createRows(fetch_tenants, form.setError)
	const backTo = useFormReturnRoute(
		queryParam('host') ? `/devices/${queryParam('host')}` : '/devices',
		props.id,
		'/devices/vm',
	)

	const [source] = createRecord(
		() => (form.editing ? null : parseId(queryParam('clone'))),
		fetch_virtual_machine,
		form.setError,
	)
	createEffect(() => {
		const row = source()
		if (row) {
			fillFrom(row)
		}
	})

	function fillFrom(row: VirtualMachineRow): void {
		setRoleId(id_value(row.device_role_id))
		setDescription(row.description ?? '')
		setHostId(row.host_device_id)
		// A clone keeps its tenant unless the global tenant selection decides.
		if (props.id !== undefined || contextTenantId() === null) {
			tenant.pick(id_value(row.tenant_id))
		}
	}

	/** Tenant the VM ends up with: the host's, else the selected one. */
	const effectiveTenantId = (): number | null =>
		hostId() === null ? parseId(tenant.value()) : (host()?.tenant_id ?? null)

	function handleHostChange(device: DeviceRow | null): void {
		setHostId(device?.id ?? null)
		if (device !== null && device.tenant_id !== effectiveTenantId()) {
			setEmployeeId('')
		}
	}

	function handleTenantChange(value: string): void {
		tenant.pick(value)
		setEmployeeId('')
	}

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const id = props.id
		const hostless = hostId() === null
		const tenantId = parseId(tenant.value())
		await submit_form({
			form,
			name: name(),
			validate: () => (roleId() ? null : t('device.selectRole')),
			save: (values: FormValues) =>
				id === undefined
					? create_virtual_machine({
							host_device_id: hostId(),
							device_role_id: Number(roleId()),
							name: values.name,
							description: text(description()),
							...(hostless ? { tenant_id: tenantId } : {}),
							employee_id: parseId(employeeId()),
						})
					: update_virtual_machine(id, {
							host_device_id: hostId(),
							device_role_id: Number(roleId()),
							name: values.name,
							description: text(description()) ?? null,
							...(hostless ? { tenant_id: tenantId } : {}),
							employee_id: parseId(employeeId()),
						}),
			navigateTo: backTo(),
			onSuccess: is_add_another_submit(e) ? () => setName('') : undefined,
		})
	}

	return (
		<FormPage
			form={form}
			title={form.editing ? t('vm.editTitle') : undefined}
			name={form.record()?.name}
			loadingText={t('vm.loadingOne')}
			cancelTo={backTo()}
			onSubmit={handleSubmit}
		>
			<FormSection title={tp('entity.virtualMachine', 1)}>
				<NameField
					id={`${prefix}-name`}
					placeholder={t('vm.namePlaceholder')}
					value={name()}
					onInput={setName}
					autofocus={!form.editing}
				/>
				<SelectField
					id={`${prefix}-role`}
					label={tp('entity.deviceRole', 1)}
					required
					value={roleId()}
					onChange={setRoleId}
					options={deviceRoleOptions(roles() ?? [])}
					emptyLabel={t('common.selectPlaceholder')}
					add={{ label: tp('entity.deviceRole', 1), href: '/device-roles/add' }}
					reload={refetchRoles}
				/>
				<DescriptionField
					id={`${prefix}-description`}
					value={description()}
					onInput={setDescription}
				/>
			</FormSection>
			<FormSection title={t('device.locationSection')}>
				<HostField
					id={`${prefix}-host`}
					host={host()}
					hostId={hostId()}
					canHost={(device: DeviceRow): boolean =>
						(roles() ?? []).some(
							(role) => role.id === device.device_role_id && role.can_host_vms === 1,
						)
					}
					onChange={handleHostChange}
				/>
				<Show when={hostId() === null}>
					<SelectField
						id={`${prefix}-tenant`}
						label={tp('entity.tenant', 1)}
						value={tenant.value()}
						onChange={handleTenantChange}
						options={row_options(tenants() ?? [])}
						emptyLabel={t('common.noTenant')}
					/>
				</Show>
			</FormSection>
			<FormSection title={t('device.assignmentSection')}>
				<EmployeeAssignmentField
					id={`${prefix}-employee`}
					tenantId={effectiveTenantId()}
					value={employeeId()}
					onChange={setEmployeeId}
					onError={form.setError}
				/>
			</FormSection>
		</FormPage>
	)
}

/** /devices/vm/add — virtual machine create form. */
export function VirtualMachineAddPage(): JSX.Element {
	return <VirtualMachineForm />
}

/** /devices/vm/:id/edit — virtual machine edit form. Saves back to the list when opened from it. */
export function VirtualMachineEditPage(props: { id: number }): JSX.Element {
	return <VirtualMachineForm id={props.id} />
}
