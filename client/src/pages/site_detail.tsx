import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal } from 'solid-js'
import { type DeviceRow, fetch_devices } from '../api_devices'
import { fetch_racks, type RackRow } from '../api_racks'
import {
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
	ForeignKeyLink,
	InlineError,
	RelatedSection,
	useDetailDelete,
} from '../components/detail_page'
import { t, tp } from '../i18n'
import { locationTypeLabel } from '../i18n/labels'
import { goTo } from '../router'
import { siteGroupTrail } from '../trails'

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

/** Flattens the location forest into preorder rows with nesting depth. */
function flattenTree(nodes: TreeNode[]): { row: LocationRow; depth: number }[] {
	const flat: { row: LocationRow; depth: number }[] = []
	const visit = (node: TreeNode, depth: number): void => {
		flat.push({ row: node.row, depth })
		for (const child of node.children) {
			visit(child, depth + 1)
		}
	}
	for (const node of nodes) {
		visit(node, 0)
	}
	return flat
}

/**
 * /sites/:id — site detail: header with description, the detail grid,
 * and the related locations/racks/devices sections.
 */
export function SiteDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)

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
	const [trail] = createResource(groupId, siteGroupTrail)
	const [locations] = createResource(
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
	const flatLocations = createMemo(() => flattenTree(tree()))
	const locationDepthOf = createMemo(() => {
		const byId = new Map<number, number>()
		for (const entry of flatLocations()) {
			byId.set(entry.row.id, entry.depth)
		}
		return (id: number): number => byId.get(id) ?? 0
	})

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
				name={site()?.name}
				crumbs={trail()}
				loading={site.loading}
				loadingText={t('site.loadingOne')}
				record={site()}
				emptyText={t('site.notFound')}
			>
				<DetailHeader
					name={site()?.name}
					editHref={`/sites/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle>{site()?.description || t('common.noDescription')}</DetailSubtitle>

				<DetailCard label={t('site.details')}>
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
					<dt>{t('common.comments')}</dt>
					<dd>{(site()?.comments ?? '') || '—'}</dd>
					<dt>{t('site.physicalAddress')}</dt>
					<dd>{(site()?.physical_address ?? '') || '—'}</dd>
					<dt>{t('site.shippingAddress')}</dt>
					<dd>{(site()?.shipping_address ?? '') || '—'}</dd>
				</DetailCard>
			</DetailShell>

			<RelatedSection
				id="site-locations"
				title={tp('entity.location', 2)}
				count={locationCount()}
				loading={locations.loading}
				loadingText={t('list.loading', { noun: tp('noun.location', 2) })}
				emptyText={t('site.noLocations')}
				hasItems={locationCount() > 0}
				viewAllHref={`/locations?site=${props.id}`}
				viewAllLabel={t('common.viewIn', { target: tp('entity.location', 2) })}
			>
				<DataTable
					rows={() => flatLocations().map((entry) => entry.row)}
					getRowId={(l: LocationRow): number => l.id}
					columns={[
						{
							key: 'name',
							label: tp('entity.location', 1),
							getValue: (l: LocationRow): JSX.Element => {
								const depth = locationDepthOf()(l.id)
								return (
									<div
										class={`location-tree-name${depth > 0 ? ' location-tree-child' : ''}`}
										style={{ '--location-depth': depth }}
									>
										<a
											href={`/locations/${l.id}`}
											onClick={(e: MouseEvent): void =>
												goTo(e, `/locations/${l.id}`)
											}
										>
											{l.name}
										</a>
									</div>
								)
							},
						},
						{
							key: 'type',
							label: t('location.type'),
							getValue: (l: LocationRow): string => locationTypeLabel(l.type),
						},
					]}
				/>
			</RelatedSection>

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
					columns={[
						{
							key: 'name',
							label: t('common.name'),
							getValue: (r: RackRow): JSX.Element => (
								<a
									href={`/racks/${r.id}`}
									onClick={(e: MouseEvent): void => goTo(e, `/racks/${r.id}`)}
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
					columns={[
						{
							key: 'name',
							label: t('common.name'),
							getValue: (d: DeviceRow): JSX.Element => (
								<a
									href={`/devices/${d.id}`}
									onClick={(e: MouseEvent): void => goTo(e, `/devices/${d.id}`)}
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
