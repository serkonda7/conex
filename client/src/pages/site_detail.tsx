import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { type DeviceRow, fetch_devices } from '../api_devices'
import { fetch_racks, type RackRow } from '../api_racks'
import {
	create_location,
	delete_location,
	delete_site,
	fetch_locations,
	fetch_site,
	fetch_site_group,
	fetch_tenant,
	type LocationRow,
} from '../api_tenancy'
import { DataTable } from '../components/data_table'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	Empty,
	ForeignKeyLink,
	InlineError,
	Loading,
	RelatedSection,
	useDetailDelete,
} from '../components/detail_page'
import { go } from '../components/list_page'
import { t, tp } from '../i18n'

interface TreeNode {
	row: LocationRow
	children: TreeNode[]
}

/** Nests the flat location list into a forest ordered by name. */
function buildTree(rows: LocationRow[]): TreeNode[] {
	const byId = new Map<number, TreeNode>()
	for (const row of rows) {
		byId.set(row.id, { row, children: [] })
	}
	const roots: TreeNode[] = []
	for (const node of byId.values()) {
		const parent = node.row.parent_id ? byId.get(node.row.parent_id) : undefined
		if (parent) {
			parent.children.push(node)
		} else {
			roots.push(node)
		}
	}
	const byName = (a: TreeNode, b: TreeNode): number => a.row.name.localeCompare(b.row.name)
	for (const node of byId.values()) {
		node.children.sort(byName)
	}
	roots.sort(byName)
	return roots
}

function LocationBranch(props: {
	node: TreeNode
	trail: string[]
	onDelete: (id: number) => void
}): JSX.Element {
	const trail = [...props.trail, props.node.row.name]
	return (
		<li>
			<code>{trail.join(' > ')}</code>{' '}
			<button
				type="button"
				class="btn-danger"
				onClick={() => props.onDelete(props.node.row.id)}
			>
				{t('common.delete')}
			</button>
			<Show when={props.node.children.length > 0}>
				<ul>
					<For each={props.node.children}>
						{(child: TreeNode): JSX.Element => (
							<LocationBranch node={child} trail={trail} onDelete={props.onDelete} />
						)}
					</For>
				</ul>
			</Show>
		</li>
	)
}

/**
 * /sites/:id — site detail: header with slug/description, related-object
 * counts, and the related locations/racks/devices sections.
 */
export function SiteDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [name, setName] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [parentId, setParentId] = createSignal('')

	const [site] = createResource(
		() => props.id,
		async (id: number) => {
			setError(null)
			const res = await fetch_site(id)
			if (Result.isError(res)) {
				setError(res.error.message)
				return null
			}
			return res.value
		},
	)
	const tenantId = createMemo(() => site()?.tenant_id ?? null)
	const [tenant] = createResource(tenantId, async (id: number | null) => {
		if (!id) {
			return null
		}
		const res = await fetch_tenant(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const groupId = createMemo(() => site()?.site_group_id ?? null)
	const [siteGroup] = createResource(groupId, async (id: number | null) => {
		if (!id) {
			return null
		}
		const res = await fetch_site_group(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const [locations, { refetch }] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_locations(id)
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items
		},
	)
	const [racks] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_racks({ site: id })
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items
		},
	)
	const [devices] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_devices({ site: id })
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items
		},
	)
	const tree = createMemo(() => buildTree(locations() ?? []))

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const res = await create_location({
			name: name(),
			slug: slug(),
			site_id: props.id,
			parent_id: parentId() ? Number(parentId()) : null,
			tenant_id: site()?.tenant_id ?? null,
		})
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setName('')
		setSlug('')
		setParentId('')
		void refetch()
	}

	async function handleLocationDelete(id: number): Promise<void> {
		setError(null)
		const res = await delete_location(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		void refetch()
	}

	const { handleDelete } = useDetailDelete({
		noun: 'noun.site',
		name: () => site()?.name,
		id: props.id,
		remove: delete_site,
		setError,
		listRoute: '/sites',
	})

	const locationCount = (): number => locations()?.length ?? 0
	const rackCount = (): number => racks()?.length ?? 0
	const deviceCount = (): number => devices()?.length ?? 0

	return (
		<div>
			<DetailShell
				backTo="/sites"
				backLabel={tp('entity.site', 2)}
				loading={site.loading}
				loadingText={t('site.loadingOne')}
				record={site()}
				emptyText={t('site.notFound')}
			>
				<DetailHeader
					name={site()?.name}
					slug={site()?.slug}
					editHref={`/sites/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle>{site()?.description || t('common.noDescription')}</DetailSubtitle>

				<div class="detail-stats">
					<a class="detail-stat" href="#site-locations">
						<span class="detail-stat-value">{locationCount()}</span>{' '}
						<span class="detail-stat-label">
							{tp('entity.location', locationCount())}
						</span>
					</a>
					<a class="detail-stat" href="#site-racks">
						<span class="detail-stat-value">{rackCount()}</span>{' '}
						<span class="detail-stat-label">{tp('entity.rack', rackCount())}</span>
					</a>
					<a class="detail-stat" href="#site-devices">
						<span class="detail-stat-value">{deviceCount()}</span>{' '}
						<span class="detail-stat-label">{tp('entity.device', deviceCount())}</span>
					</a>
				</div>

				<DetailCard label={t('site.details')}>
					<dt>{t('common.slug')}</dt>
					<dd>
						<code>{site()?.slug}</code>
					</dd>
					<dt>{tp('entity.tenant', 1)}</dt>
					<dd>
						<ForeignKeyLink
							id={tenantId()}
							loading={tenant.loading}
							name={tenant()?.name}
							href={`/tenants/${tenantId() ?? ''}`}
						/>
					</dd>
					<dt>{t('common.group')}</dt>
					<dd>
						<ForeignKeyLink
							id={groupId()}
							loading={siteGroup.loading}
							name={siteGroup()?.name}
							href={`/site-groups/${groupId() ?? ''}`}
						/>
					</dd>
					<dt>{t('common.description')}</dt>
					<dd>{site()?.description || '—'}</dd>
					<dt>{t('common.comments')}</dt>
					<dd>{(site()?.comments ?? '') || '—'}</dd>
					<dt>{t('site.physicalAddress')}</dt>
					<dd>{(site()?.physical_address ?? '') || '—'}</dd>
					<dt>{t('site.shippingAddress')}</dt>
					<dd>{(site()?.shipping_address ?? '') || '—'}</dd>
				</DetailCard>
			</DetailShell>

			<section aria-label={tp('entity.location', 2)}>
				<h3 id="site-locations">
					{tp('entity.location', 2)} <span class="badge">{locationCount()}</span>
				</h3>
				<form onSubmit={handleCreate}>
					<input
						placeholder={t('common.name')}
						aria-label={t('site.locationName')}
						value={name()}
						onInput={(e: InputEventAndTarget) => setName(e.currentTarget.value)}
					/>
					<input
						placeholder={t('site.slugPlaceholderShort')}
						aria-label={t('site.locationSlug')}
						value={slug()}
						onInput={(e: InputEventAndTarget) => setSlug(e.currentTarget.value)}
					/>
					<select
						aria-label={t('site.parentLocation')}
						value={parentId()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setParentId(e.currentTarget.value)
						}
					>
						<option value="">{t('site.topLevel')}</option>
						<For each={locations() ?? []}>
							{(l: LocationRow): JSX.Element => (
								<option value={l.id}>{l.name}</option>
							)}
						</For>
					</select>
					<button type="submit">{t('site.addLocation')}</button>
				</form>
				<Show
					when={!locations.loading}
					fallback={
						<Loading message={t('list.loading', { noun: tp('noun.location', 2) })} />
					}
				>
					<Show
						when={tree().length > 0}
						fallback={<Empty message={t('site.noLocations')} />}
					>
						<ul>
							<For each={tree()}>
								{(node: TreeNode): JSX.Element => (
									<LocationBranch
										node={node}
										trail={[site()?.name ?? tp('noun.site', 1)]}
										onDelete={handleLocationDelete}
									/>
								)}
							</For>
						</ul>
					</Show>
				</Show>
			</section>

			<RelatedSection
				id="site-racks"
				title={tp('entity.rack', 2)}
				count={rackCount()}
				loading={racks.loading}
				loadingText={t('list.loading', { noun: tp('noun.rack', 2) })}
				emptyText={t('site.noRacks')}
				hasItems={rackCount() > 0}
			>
				<DataTable
					rows={() => racks() ?? []}
					getRowId={(r: RackRow): number => r.id}
					showColumnCustomizer
					columns={[
						{
							key: 'name',
							label: t('common.name'),
							getValue: (r: RackRow): JSX.Element => (
								<a
									href={`/racks/${r.id}`}
									onClick={(e: MouseEvent): void => go(e, `/racks/${r.id}`)}
								>
									{r.name}
								</a>
							),
						},
						{
							key: 'height',
							label: t('common.height'),
							getValue: (r: RackRow): string =>
								t('common.heightUnits', { count: r.height_u }),
						},
					]}
				/>
			</RelatedSection>

			<RelatedSection
				id="site-devices"
				title={tp('entity.device', 2)}
				count={deviceCount()}
				loading={devices.loading}
				loadingText={t('list.loading', { noun: tp('noun.device', 2) })}
				emptyText={t('site.noDevices')}
				hasItems={deviceCount() > 0}
			>
				<DataTable
					rows={() => devices() ?? []}
					getRowId={(d: DeviceRow): number => d.id}
					showColumnCustomizer
					columns={[
						{
							key: 'name',
							label: t('common.name'),
							getValue: (d: DeviceRow): JSX.Element => (
								<a
									href={`/devices/${d.id}`}
									onClick={(e: MouseEvent): void => go(e, `/devices/${d.id}`)}
								>
									{d.name}
								</a>
							),
						},
					]}
				/>
			</RelatedSection>

			<InlineError message={error()} />
		</div>
	)
}
