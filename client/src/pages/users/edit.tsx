import { createSignal, type JSX, Show } from 'solid-js'
import { fetch_roles, type RoleJson } from '../../api/roles'
import { fetch_tenants } from '../../api/tenancy'
import { fetch_user, type UserJson, update_user } from '../../api/users'
import { FormPage, Hint, row_options, SelectField, TextField } from '../../components/form'
import { t } from '../../i18n'
import { id_value, submit_form, useEntityForm } from '../../lib/form'
import { createRows } from '../../lib/resource'
import { parseId } from '../../lib/router'
import { managesUsers, RoleHint } from './role_hint'

/** /users/:id/edit — role, tenant-scope, and password form (`users.manage`). */
export function UserEditPage(props: { id: number }): JSX.Element {
	const [roleId, setRoleId] = createSignal('')
	const [tenantId, setTenantId] = createSignal('')
	const [password, setPassword] = createSignal('')
	const form = useEntityForm({
		id: props.id,
		load: fetch_user,
		fill: (row: UserJson) => {
			setRoleId(id_value(row.role_id))
			setTenantId(id_value(row.tenant_id))
		},
	})
	const [tenants] = createRows(fetch_tenants)
	const [roles] = createRows(fetch_roles)
	const role = (): RoleJson | undefined => roles()?.find((r) => r.id === parseId(roleId()))

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			form,
			name: '',
			optionalName: true,
			validate: () => (parseId(roleId()) === null ? t('user.selectRole') : null),
			save: () =>
				update_user(props.id, {
					role_id: parseId(roleId()) ?? undefined,
					tenant_id: managesUsers(role()) ? null : parseId(tenantId()),
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
				required
				value={roleId()}
				onChange={setRoleId}
				options={row_options(roles() ?? [])}
				hint={<RoleHint role={role()} />}
			/>
			<Show when={!managesUsers(role())}>
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
