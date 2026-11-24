import {
	BILLING_METRICS,
	type BillingMetric,
	type BillingMetricConfig,
	STORAGE_STEP_GB_DEFAULT,
} from 'shared/src/schemas'
import { createSignal, For, type JSX, Show } from 'solid-js'
import {
	create_managed_bundle,
	fetch_managed_bundle,
	type ManagedBundleRow,
	update_managed_bundle,
} from '../../api/service_catalog'
import {
	DescriptionField,
	Field,
	FormPage,
	FormSection,
	Hint,
	NameField,
	TextField,
} from '../../components/form'
import { t } from '../../i18n'
import { billingMetricHint, billingMetricLabel } from '../../i18n/labels'
import { type FormValues, submit_entity_form, text, useEntityForm } from '../../lib/form'
import { queryParam, useFormReturnRoute } from '../../lib/router'

/**
 * Billing metrics of the bundle: a checkbox per metric with what it counts;
 * stored data also takes the GB of one lot.
 */
function BillingMetricsField(props: {
	prefix: string
	metrics: ReadonlySet<BillingMetric>
	onToggle: (metric: BillingMetric, on: boolean) => void
	stepGb: string
	onStepGb: (value: string) => void
}): JSX.Element {
	return (
		<>
			<Field
				label={t('managedBundle.billingMetrics')}
				hint={<Hint>{t('managedBundle.billingHint')}</Hint>}
			>
				<div class="billing-metric-list">
					<For each={BILLING_METRICS}>
						{(metric: BillingMetric) => (
							<label class="field-checkbox-label">
								<input
									id={`${props.prefix}-metric-${metric}`}
									type="checkbox"
									checked={props.metrics.has(metric)}
									onChange={(e: Event & { currentTarget: HTMLInputElement }) =>
										props.onToggle(metric, e.currentTarget.checked)
									}
								/>
								<span>
									{billingMetricLabel(metric)}
									<span class="field-hint">{billingMetricHint(metric)}</span>
								</span>
							</label>
						)}
					</For>
				</div>
			</Field>
			<Show when={props.metrics.has('storage')}>
				<TextField
					id={`${props.prefix}-storage-step`}
					label={t('managedBundle.storageStep')}
					type="number"
					min={1}
					step={1}
					inputmode="numeric"
					value={props.stepGb}
					onInput={props.onStepGb}
				/>
			</Show>
		</>
	)
}

/** Managed bundle create (`id` omitted) or edit form. */
function ManagedBundleForm(props: { id?: number }): JSX.Element {
	// `?name=` comes from the search typed into an opener's dropdown.
	const [name, setName] = createSignal(queryParam('name'))
	const [description, setDescription] = createSignal('')
	const [metrics, setMetrics] = createSignal<ReadonlySet<BillingMetric>>(new Set(['objects']))
	const [stepGb, setStepGb] = createSignal(String(STORAGE_STEP_GB_DEFAULT))
	const form = useEntityForm({
		id: props.id,
		load: fetch_managed_bundle,
		fill: (row: ManagedBundleRow) => {
			setName(row.name)
			setDescription(row.description ?? '')
			setMetrics(new Set(row.billing_metrics.map((m) => m.metric)))
			const storage = row.billing_metrics.find((m) => m.metric === 'storage')
			setStepGb(String(storage?.step_gb ?? STORAGE_STEP_GB_DEFAULT))
		},
	})
	function toggleMetric(metric: BillingMetric, on: boolean): void {
		const next = new Set(metrics())
		if (on) {
			next.add(metric)
		} else {
			next.delete(metric)
		}
		setMetrics(next)
	}
	/** Checked metrics in catalog order. */
	const billingMetrics = (): BillingMetricConfig[] =>
		BILLING_METRICS.filter((m) => metrics().has(m)).map((metric) =>
			metric === 'storage' ? { metric, step_gb: Number(stepGb()) } : { metric },
		)
	const prefix = form.editing ? 'managed-bundle-edit' : 'managed-bundle'
	const backTo = useFormReturnRoute('/managed-bundles', props.id)

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		await submit_entity_form(e, {
			form,
			name: name(),
			validate: () => {
				const step = Number(stepGb())
				return metrics().has('storage') && !(Number.isInteger(step) && step >= 1)
					? t('managedBundle.storageStepInvalid')
					: null
			},
			body: (values: FormValues) => ({
				name: values.name,
				description: text(description()),
				billing_metrics: billingMetrics(),
			}),
			create: create_managed_bundle,
			update: update_managed_bundle,
			navigateTo: backTo(),
			reset: () => {
				setName('')
				setDescription('')
				setMetrics(new Set<BillingMetric>(['objects']))
				setStepGb(String(STORAGE_STEP_GB_DEFAULT))
			},
		})
	}

	return (
		<FormPage
			form={form}
			title={form.editing ? t('managedBundle.editTitle') : t('managedBundle.addTitle')}
			name={form.record()?.name}
			loadingText={t('managedBundle.loadingOne')}
			cancelTo={backTo()}
			onSubmit={handleSubmit}
		>
			<NameField
				id={`${prefix}-name`}
				placeholder={t('managedBundle.namePlaceholder')}
				value={name()}
				onInput={setName}
				autofocus
			/>
			<DescriptionField
				id={`${prefix}-description`}
				value={description()}
				onInput={setDescription}
			/>
			<Hint>{t('managedBundle.rolesHint')}</Hint>
			<FormSection title={t('managedBundle.billingSection')}>
				<BillingMetricsField
					prefix={prefix}
					metrics={metrics()}
					onToggle={toggleMetric}
					stepGb={stepGb()}
					onStepGb={setStepGb}
				/>
			</FormSection>
		</FormPage>
	)
}

/** /managed-bundles/add — managed bundle create form. */
export function ManagedBundleAddPage(): JSX.Element {
	return <ManagedBundleForm />
}

/** /managed-bundles/:id/edit — managed bundle edit form. Saves back to the list when opened from it. */
export function ManagedBundleEditPage(props: { id: number }): JSX.Element {
	return <ManagedBundleForm id={props.id} />
}
