import { StatusBadge, Table } from "@conex/ui";
import { A, useNavigate, useParams } from "@solidjs/router";
import { IconChevronLeft, IconPlus, IconTrash } from "@tabler/icons-solidjs";
import {
	createMutation,
	createQuery,
	useQueryClient,
} from "@tanstack/solid-query";
import type { Component } from "solid-js";
import { createSignal, For, Show } from "solid-js";
import { ClientForm } from "../components/client-form.js";
import { ContactDrawer } from "../components/contact-drawer.js";
import type { Col } from "../components/ui-helpers.js";
import {
	EmptyState,
	ErrorState,
	Field,
	LoadingState,
} from "../components/ui-helpers.js";
import type { Client, ClientInput, Contact, Site } from "../lib/api.js";
import {
	contactName,
	contactSiteId,
	createSite,
	deleteClient,
	deleteContact,
	fetchClient,
	fetchClients,
	fetchContacts,
	fetchSites,
	keys,
	toMessage,
	updateClient,
} from "../lib/api.js";
import { validateSite } from "../lib/validation.js";

const ClientDetailPage: Component = () => {
	const params = useParams();
	const navigate = useNavigate();
	const qc = useQueryClient();
	const id = () => params.id ?? "";

	const [editError, setEditError] = createSignal<string | null>(null);
	const [siteName, setSiteName] = createSignal("");
	const [siteCity, setSiteCity] = createSignal("");
	const [sitePrimary, setSitePrimary] = createSignal(false);
	const [siteError, setSiteError] = createSignal<string | null>(null);
	const [siteFieldError, setSiteFieldError] = createSignal<
		string | undefined
	>(undefined);
	const [contactDrawerOpen, setContactDrawerOpen] = createSignal(false);
	const [editingContact, setEditingContact] = createSignal<Contact | null>(
		null,
	);

	const clientQuery = createQuery(() => ({
		queryKey: keys.client(id()),
		queryFn: () => fetchClient(id()),
		enabled: !!id(),
	}));
	const sitesQuery = createQuery(() => ({
		queryKey: keys.sites(id()),
		queryFn: () => fetchSites(id()),
		enabled: !!id(),
	}));
	const contactsQuery = createQuery(() => ({
		queryKey: keys.contacts({ clientId: id() }),
		queryFn: () => fetchContacts({ clientId: id() }),
		enabled: !!id(),
	}));
	const clientsQuery = createQuery(() => ({
		queryKey: keys.clients,
		queryFn: () => fetchClients(),
	}));

	const updateMut = createMutation(() => ({
		mutationFn: (input: ClientInput) => updateClient(id(), input),
		onSuccess: () => {
			setEditError(null);
			qc.invalidateQueries({ queryKey: keys.client(id()) });
			qc.invalidateQueries({ queryKey: keys.clients });
		},
		onError: (e) => setEditError(toMessage(e)),
	}));

	const deleteMut = createMutation(() => ({
		mutationFn: () => deleteClient(id()),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.clients });
			navigate("/clients");
		},
		onError: (e) => window.alert(toMessage(e)),
	}));

	const siteMut = createMutation(() => ({
		mutationFn: () =>
			createSite(id(), {
				name: siteName().trim(),
				city: siteCity().trim() || undefined,
				is_primary: sitePrimary(),
			}),
		onSuccess: () => {
			setSiteName("");
			setSiteCity("");
			setSitePrimary(false);
			setSiteError(null);
			setSiteFieldError(undefined);
			qc.invalidateQueries({ queryKey: keys.sites(id()) });
		},
		onError: (e) => setSiteError(toMessage(e)),
	}));

	const contactDeleteMut = createMutation(() => ({
		mutationFn: (contactId: string) => deleteContact(contactId),
		onSuccess: () => qc.invalidateQueries({ queryKey: keys.contacts() }),
		onError: (e) => window.alert(toMessage(e)),
	}));

	const submitSite = (e: Event) => {
		e.preventDefault();
		const errs = validateSite({ name: siteName() });
		setSiteFieldError(errs.name);
		if (errs.name) return;
		siteMut.mutate();
	};

	const askDeleteClient = (c: Client) => {
		if (window.confirm(`Delete client "${c.name}" and all its data?`)) {
			deleteMut.mutate();
		}
	};

	const askDeleteContact = (c: Contact) => {
		if (window.confirm(`Remove ${contactName(c)} from this client?`)) {
			contactDeleteMut.mutate(c.id);
		}
	};

	const siteNameOf = (c: Contact): string => {
		if (c.site_name) return c.site_name;
		const sid = contactSiteId(c);
		if (!sid) return "—";
		return sitesQuery.data?.find((s) => s.id === sid)?.name ?? "—";
	};

	const contactColumns: Col[] = [
		{
			key: "name",
			header: "Name",
			render: (row) => contactName(row as unknown as Contact),
		},
		{ key: "email", header: "Email" },
		{ key: "title", header: "Title" },
		{
			key: "site",
			header: "Site",
			render: (row) => siteNameOf(row as unknown as Contact),
		},
		{
			key: "is_primary",
			header: "Primary",
			render: (row) =>
				(row as unknown as Contact).is_primary ? (
					<span class="status-badge">primary</span>
				) : (
					"—"
				),
		},
		{
			key: "actions",
			header: "Actions",
			render: (row) => {
				const c = row as unknown as Contact;
				return (
					<span class="row-actions">
						<button
							type="button"
							class="btn"
							onClick={() => {
								setEditingContact(c);
								setContactDrawerOpen(true);
							}}
						>
							Edit
						</button>
						<button
							type="button"
							class="btn btn-icon btn-danger"
							title="Delete"
							disabled={contactDeleteMut.isPending}
							onClick={() => askDeleteContact(c)}
						>
							<IconTrash size={15} />
						</button>
					</span>
				);
			},
		},
	];

	const contacts = () => contactsQuery.data ?? [];
	const sites = () => sitesQuery.data ?? [];

	return (
		<main class="page">
			<A href="/clients" class="back-link">
				<IconChevronLeft size={14} /> All clients
			</A>

			<Show when={clientQuery.isPending}>
				<LoadingState label="Loading client…" />
			</Show>
			<Show when={clientQuery.isError}>
				<ErrorState
					message={`Could not load client: ${toMessage(clientQuery.error)}`}
					onRetry={() => clientQuery.refetch()}
				/>
			</Show>

			<Show when={clientQuery.data}>
				{(client) => (
					<>
						<div class="page-header">
							<h1>
								{client().name}{" "}
								<StatusBadge status={String(client().status)} />
							</h1>
							<button
								type="button"
								class="btn btn-danger"
								disabled={deleteMut.isPending}
								onClick={() => askDeleteClient(client())}
							>
								<IconTrash size={15} /> Delete client
							</button>
						</div>

						<div class="grid-2">
							<section class="card">
								<h2>Edit client</h2>
								<ClientForm
									initial={client()}
									saving={updateMut.isPending}
									serverError={editError()}
									submitLabel="Save changes"
									onSubmit={(input) =>
										updateMut.mutateAsync(input)
									}
								/>
							</section>

							<section class="card">
								<div class="card-row">
									<h2>Sites ({sites().length})</h2>
								</div>
								<Show when={sitesQuery.isPending}>
									<LoadingState label="Loading sites…" />
								</Show>
								<Show when={sitesQuery.isError}>
									<ErrorState
										message={`Could not load sites: ${toMessage(sitesQuery.error)}`}
										onRetry={() => sitesQuery.refetch()}
									/>
								</Show>
								<Show
									when={
										sitesQuery.isSuccess &&
										sites().length === 0
									}
								>
									<p class="muted">
										No sites yet — add the first one below.
									</p>
								</Show>
								<Show when={sites().length > 0}>
									<table>
										<thead>
											<tr>
												<th>Name</th>
												<th>City</th>
												<th>Primary</th>
											</tr>
										</thead>
										<tbody>
											<For each={sites()}>
												{(s: Site) => (
													<tr>
														<td>{s.name}</td>
														<td>{s.city || "—"}</td>
														<td>
															{s.is_primary ? (
																<span class="status-badge">
																	primary
																</span>
															) : (
																"—"
															)}
														</td>
													</tr>
												)}
											</For>
										</tbody>
									</table>
								</Show>
								<form
									class="inline-form"
									onSubmit={submitSite}
									novalidate
								>
									<Field
										label="New site name"
										error={siteFieldError()}
									>
										<input
											class="input"
											value={siteName()}
											onInput={(e) =>
												setSiteName(
													e.currentTarget.value,
												)
											}
											placeholder="Headquarters"
										/>
									</Field>
									<Field label="City">
										<input
											class="input"
											value={siteCity()}
											onInput={(e) =>
												setSiteCity(
													e.currentTarget.value,
												)
											}
											placeholder="Berlin"
										/>
									</Field>
									<label class="check-row">
										<input
											type="checkbox"
											checked={sitePrimary()}
											onChange={(e) =>
												setSitePrimary(
													e.currentTarget.checked,
												)
											}
										/>
										<span>Primary</span>
									</label>
									<button
										type="submit"
										class="btn btn-primary"
										disabled={siteMut.isPending}
									>
										<IconPlus size={15} />{" "}
										{siteMut.isPending
											? "Adding…"
											: "Add site"}
									</button>
								</form>
								<Show when={siteError()}>
									<p class="server-error" role="alert">
										{siteError()}
									</p>
								</Show>
							</section>
						</div>

						<section class="card">
							<div class="card-row">
								<h2>Contacts ({contacts().length})</h2>
								<button
									type="button"
									class="btn btn-primary"
									onClick={() => {
										setEditingContact(null);
										setContactDrawerOpen(true);
									}}
								>
									<IconPlus size={15} /> Add person
								</button>
							</div>
							<Show when={contactsQuery.isPending}>
								<LoadingState label="Loading contacts…" />
							</Show>
							<Show when={contactsQuery.isError}>
								<ErrorState
									message={`Could not load contacts: ${toMessage(contactsQuery.error)}`}
									onRetry={() => contactsQuery.refetch()}
								/>
							</Show>
							<Show
								when={
									contactsQuery.isSuccess &&
									contacts().length === 0
								}
							>
								<EmptyState
									title="No contacts yet"
									hint="Add the first person for this client."
								/>
							</Show>
							<Show when={contacts().length > 0}>
								<Table
									columns={contactColumns}
									rows={contacts()}
								/>
							</Show>
						</section>
					</>
				)}
			</Show>

			<ContactDrawer
				open={contactDrawerOpen()}
				contact={editingContact()}
				defaultClientId={id()}
				clients={clientsQuery.data ?? []}
				onClose={() => {
					setContactDrawerOpen(false);
					setEditingContact(null);
				}}
			/>
		</main>
	);
};

export default ClientDetailPage;
