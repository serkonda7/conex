import { createSignal, type JSX, Show } from 'solid-js'
import { fetch_tenants } from '../../api/tenancy'
import { fetch_user, type UserJson, type UserRole, update_user } from '../../api/users'
import { FormPage, Hint, row_options, SelectField, TextField } from '../../components/form'
import { t } from '../../i18n'
import { roleOptions } from '../../i18n/labels'
import { id_value, submit_form, useEntityForm } from '../../lib/form'
import { createRows } from '../../lib/resource'
import { parseId } from '../../lib/router'
import { RoleHint } from './role_hint'

/** /users/:id/edit — admin-only role, tenant-scope, and password form. */
export function UserEditPage(props: { id: number }): JSX.Element {
	const [role, setRole] = createSignal<UserRole>('viewer')
	const [tenantId, setTenantId] = createSignal('')
	const [password, setPassword] = createSignal('')
	const form = useEntityForm({
		id: props.id,
		load: fetch_user,
		fill: (row: UserJson) => {
			setRole(row.role)
			setTenantId(id_value(row.tenant_id))
		},
	})
	const [tenants] = createRows(fetch_tenants)

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const tenant = parseId(tenantId())
		await submit_form({
			form,
			name: '',
			optionalName: true,
			validate: () => (role() === 'admin' && tenant !== null ? t('user.adminGlobal') : null),
			save: () =>
				update_user(props.id, {
					role: role(),
					tenant_id: tenant,
					...(password() ? { password: password() } : {}),
				}),
			navigateTo: '/users',
		})
	}

	return (
		<FormPage
			form={form}
			title={t('user.editTitle')}
			name={form.record()?.username}
			loadingText={t('user.loadingOne')}
			cancelTo="/users"
			onSubmit={handleSave}
		>
			<SelectField
				id="user-edit-role"
				label={t('user.role')}
				value={role()}
				onChange={(value: string) => setRole(value as UserRole)}
				options={roleOptions()}
				hint={
					<RoleHint> {t('user.roleHintLastAdmin', { admin: t('role.admin') })}</RoleHint>
				}
			/>
			<Show when={role() !== 'admin'}>
				<SelectField
					id="user-edit-tenant"
					label={t('user.tenantScope')}
					value={tenantId()}
					onChange={setTenantId}
					options={row_options(tenants() ?? [])}
					emptyLabel={t('common.allTenants')}
					hint={<Hint>{t('user.tenantHint')}</Hint>}
				/>
			</Show>
			<TextField
				id="user-edit-password"
				label={t('user.newPassword')}
				type="password"
				placeholder={t('user.keepPassword')}
				value={password()}
				onInput={setPassword}
				autocomplete="new-password"
			/>
		</FormPage>
	)
}
