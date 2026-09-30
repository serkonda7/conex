import { createSignal, type JSX } from 'solid-js'
import {
	delete_site_group,
	fetch_site_group,
	fetch_sites,
	fetch_tenant,
	type SiteRow,
} from '../../api/tenancy'
import { nameColumn } from '../../components/data_table'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	RecordLink,
	RelatedSection,
	useDetailDelete,
} from '../../components/detail_page'
import { InlineError } from '../../components/feedback'
import { t, tp } from '../../i18n'
import { createRecord, createRowsFor } from '../../lib/resource'

/**
 * /site-groups/:id — flat site group detail: header with slug,
 * detail grid, and the sites-in-group table.
 */
export function SiteGroupDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const id = (): number => props.id
	const [group] = createRecord(id, fetch_site_group, setError)
	const tenantId = (): number | null | undefined => group()?.tenant_id
	const [tenant] = createRecord(tenantId, fetch_tenant, setError)
	const [sites] = createRowsFor(id, (key: number) => fetch_sites({ group: key }), setError)

	const handleDelete = useDetailDelete({
		noun: 'noun.siteGroup',
		name: () => group()?.name,
		id: props.id,
		remove: delete_site_group,
		setError,
		listRoute: '/site-groups',
	})

	return (
		<div>
			<DetailShell
				name={group()?.name}
				record={group}
				loadingText={t('siteGroup.loadingOne')}
				emptyText={t('siteGroup.notFound')}
			>
				<DetailHeader
					name={group()?.name}
					slug={group()?.slug}
					editHref={`/site-groups/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle description={group()?.description} />

				<DetailCard label={t('siteGroup.details')}>
					<dt>{t('common.slug')}</dt>
					<dd>
						<code>{group()?.slug}</code>
					</dd>
					<dt>{tp('entity.tenant', 1)}</dt>
					<dd>
						<RecordLink id={tenantId()} record={tenant} base="/tenants" />
					</dd>
					<dt>{t('common.description')}</dt>
					<dd>{group()?.description || '—'}</dd>
					<dt>{t('common.comments')}</dt>
					<dd>{group()?.comments || '—'}</dd>
				</DetailCard>
			</DetailShell>

			<RelatedSection
				id="site-group-sites"
				title={tp('entity.site', 2)}
				noun="noun.site"
				rows={sites}
				emptyText={t('siteGroup.noSites')}
				customizable
				columns={[nameColumn<SiteRow>(t('common.name'), '/sites')]}
			/>

			<InlineError message={error()} />
		</div>
	)
}
