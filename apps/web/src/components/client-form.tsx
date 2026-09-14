import { Drawer } from "@conex/ui";
import type { JSX } from "solid-js";
import { createEffect, createSignal, Show } from "solid-js";
import type { Client, ClientInput, ClientStatus } from "../lib/api.js";
import { CLIENT_STATUSES } from "../lib/api.js";
import { hasErrors, slugify, validateClient } from "../lib/validation.js";
import { Field } from "./ui-helpers.js";

export type ClientFormValues = {
	name: string;
	slug: string;
	status: ClientStatus;
	billing_email: string;
	phone: string;
	notes: string;
};

function toValues(initial?: Client | null): ClientFormValues {
	return {
		name: initial?.name ?? "",
		slug: initial?.slug ?? "",
		status: (initial?.status as ClientStatus) ?? "active",
		billing_email: initial?.billing_email ?? "",
		phone: initial?.phone ?? "",
		notes: initial?.notes ?? "",
	};
}

function toInput(v: ClientFormValues): ClientInput {
	const input: ClientInput = {
		name: v.name.trim(),
		slug: v.slug.trim() || slugify(v.name),
		status: v.status,
	};
	if (v.billing_email.trim()) input.billing_email = v.billing_email.trim();
	if (v.phone.trim()) input.phone = v.phone.trim();
	if (v.notes.trim()) input.notes = v.notes.trim();
	return input;
}

/**
 * Controlled create/edit form for a client (tenant). Stateless w.r.t.
 * server: the parent owns the mutation and passes saving/serverError.
 * Re-syncs whenever a *different* initial record arrives (covers the
 * async-load case on the detail page without clobbering edits).
 */
export function ClientForm(props: {
	initial?: Client | null;
	saving?: boolean;
	serverError?: string | null;
	submitLabel?: string;
	onSubmit: (values: ClientInput) => Promise<unknown> | unknown;
}): JSX.Element {
	const [values, setValues] = createSignal<ClientFormValues>(
		toValues(props.initial),
	);
	const [errors, setErrors] = createSignal<
		Record<string, string | undefined>
	>({});
	const [syncedId, setSyncedId] = createSignal<string | null | undefined>(
		undefined,
	);

	createEffect(() => {
		const init = props.initial;
		const id = init?.id ?? null;
		if (id !== syncedId()) {
			setSyncedId(id);
			setValues(toValues(init));
			setErrors({});
		}
	});

	const set = (key: keyof ClientFormValues, value: string) =>
		setValues((v) => ({ ...v, [key]: value }));

	const submit = async (e: Event) => {
		e.preventDefault();
		const v = values();
		const errs = validateClient(v);
		setErrors(errs);
		if (hasErrors(errs)) return;
		await props.onSubmit(toInput(v));
	};

	const v = values;
	return (
		<form class="form" onSubmit={submit} novalidate>
			<Show when={props.serverError}>
				<p class="server-error" role="alert">
					{props.serverError}
				</p>
			</Show>
			<Field label="Name" error={errors().name}>
				<input
					class="input"
					value={v().name}
					onInput={(e) => {
						set("name", e.currentTarget.value);
						// Keep slug in sync until the user customizes it.
						if (!v().slug)
							set("slug", slugify(e.currentTarget.value));
					}}
					placeholder="Acme GmbH"
				/>
			</Field>
			<Field
				label="Slug"
				error={errors().slug}
				hint="URL-safe identifier, auto-generated from the name."
			>
				<input
					class="input"
					value={v().slug}
					onInput={(e) => set("slug", e.currentTarget.value)}
					placeholder="acme-gmbh"
				/>
			</Field>
			<Field label="Status" error={errors().status}>
				<select
					value={v().status}
					onChange={(e) => set("status", e.currentTarget.value)}
				>
					{CLIENT_STATUSES.map((s) => (
						<option value={s}>{s}</option>
					))}
				</select>
			</Field>
			<Field label="Billing email" error={errors().billing_email}>
				<input
					class="input"
					type="email"
					value={v().billing_email}
					onInput={(e) => set("billing_email", e.currentTarget.value)}
					placeholder="billing@example.com"
				/>
			</Field>
			<Field label="Phone" error={errors().phone}>
				<input
					class="input"
					type="tel"
					value={v().phone}
					onInput={(e) => set("phone", e.currentTarget.value)}
					placeholder="+49 …"
				/>
			</Field>
			<Field label="Notes">
				<textarea
					rows={3}
					value={v().notes}
					onInput={(e) => set("notes", e.currentTarget.value)}
					placeholder="Contract notes, onboarding state, …"
				/>
			</Field>
			<div class="form-actions">
				<button
					type="submit"
					class="btn btn-primary"
					disabled={props.saving}
				>
					{props.saving
						? "Saving…"
						: (props.submitLabel ?? "Save client")}
				</button>
			</div>
		</form>
	);
}

/** Create-drawer used on /clients (remounts the form on every open). */
export function ClientDrawer(props: {
	open: boolean;
	saving?: boolean;
	serverError?: string | null;
	onClose: () => void;
	onSubmit: (values: ClientInput) => Promise<unknown> | unknown;
}): JSX.Element {
	return (
		<Drawer open={props.open} onClose={props.onClose}>
			<h2>New client</h2>
			<Show when={props.open}>
				<ClientForm
					saving={props.saving}
					serverError={props.serverError}
					submitLabel="Create client"
					onSubmit={props.onSubmit}
				/>
			</Show>
		</Drawer>
	);
}
