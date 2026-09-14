import { Table } from "@conex/ui";
import { A } from "@solidjs/router";
import {
	createMutation,
	createQuery,
	useQueryClient,
} from "@tanstack/solid-query";
import type { Component } from "solid-js";
import { createEffect, createSignal, For, Show } from "solid-js";
import { IconPlus, IconTrash } from "solid-tabler-icons";
import { ContactDrawer } from "../components/contact-drawer.js";
import { SearchInput } from "../components/search-input.js";
import type { Col } from "../components/ui-helpers.js";
import {
	EmptyState,
	ErrorState,
	LoadingState,
} from "../components/ui-helpers.js";
import type { Contact } from "../lib/api.js";
import {
	contactClientId,
	contactName,
	contactSiteId,
	deleteContact,
	fetchClients,
	fetchContacts,
	fetchSites,
	keys,
	toMessage,
} from "../lib/api.js";
import { useDebounced } from "../lib/use-debounced.js";

const PeoplePage: Component = () => {
	const qc = useQueryClient();
	const [search, setSearch] = createSignal("");
	const [clientId, setClientId] = createSignal("");
	const [siteId, setSiteId] = createSignal("");
	const [drawerOpen, setDrawerOpen] = createSignal(false);
	const [editing, setEditing] = createSignal<Contact | null>(null);
	const debounced = useDebounced(search);

	const clientsQuery = createQuery(() => ({
		queryKey: keys.clients,
		queryFn: () => fetchClients(),
	}));

	// Site filter options follow the selected client.
	const sitesQuery = createQuery(() => ({
		queryKey: keys.sites(clientId() || "none"),
		queryFn: () =>
			clientId() ? fetchSites(clientId()) : Promise.resolve([]),
	}));

	const contactsQuery = createQuery(() => ({
		queryKey: keys.contacts({
			clientId: clientId() || undefined,
			siteId: siteId() || undefined,
			q: debounced() || undefined,
		}),
		queryFn: () =>
			fetchContacts({
				clientId: clientId() || undefined,
				siteId: siteId() || undefined,
				q: debounced() || undefined,
			}),
	}));

	const deleteMut = createMutation(() => ({
		mutationFn: (contactId: string) => deleteContact(contactId),
		onSuccess: () => qc.invalidateQueries({ queryKey: keys.contacts() }),
		onError: (e) => window.alert(toMessage(e)),
	}));

	// Changing the client resets the site filter (sites belong to a client).
	createEffect(() => {
		clientId();
		setSiteId("");
	});

	const clients = () => clientsQuery.data ?? [];
	const clientNameOf = (c: Contact): string => {
		if (c.client_name) return c.client_name;
		const cid = contactClientId(c);
		if (!cid) return "—";
		return clients().find((x) => x.id === cid)?.name ?? "—";
	};
	const siteNameOf = (c: Contact): string => {
		if (c.site_name) return c.site_name;
		const sid = contactSiteId(c);
		if (!sid) return "—";
		return sitesQuery.data?.find((s) => s.id === sid)?.name ?? "—";
	};

	const askDelete = (c: Contact) => {
		if (
			window.confirm(`Delete ${contactName(c)}? This cannot be undone.`)
		) {
			deleteMut.mutate(c.id);
		}
	};

	const columns: Col[] = [
		{
			key: "name",
			header: "Name",
			render: (row) => contactName(row as unknown as Contact),
		},
		{ key: "email", header: "Email" },
		{ key: "title", header: "Title" },
		{
			key: "client",
			header: "Client",
			render: (row) => {
				const c = row as unknown as Contact;
				const cid = contactClientId(c);
				const label = clientNameOf(c);
				return cid ? <A href={`/clients/${cid}`}>{label}</A> : label;
			},
		},
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
								setEditing(c);
								setDrawerOpen(true);
							}}
						>
							Edit / move
						</button>
						<button
							type="button"
							class="btn btn-icon btn-danger"
							title="Delete"
							disabled={deleteMut.isPending}
							onClick={() => askDelete(c)}
						>
							<IconTrash size={15} />
						</button>
					</span>
				);
			},
		},
	];

	const rows = () => contactsQuery.data ?? [];

	return (
		<main class="page">
			<div class="page-header">
				<h1>
					People{" "}
					<span class="count">
						{contactsQuery.data
							? `(${contactsQuery.data.length})`
							: ""}
					</span>
				</h1>
				<button
					type="button"
					class="btn btn-primary"
					onClick={() => {
						setEditing(null);
						setDrawerOpen(true);
					}}
				>
					<IconPlus size={15} /> New person
				</button>
			</div>

			<div class="toolbar">
				<SearchInput
					value={search()}
					onInput={setSearch}
					placeholder="Search people…  (⌘K)"
				/>
				<select
					value={clientId()}
					onChange={(e) => setClientId(e.currentTarget.value)}
				>
					<option value="">All clients</option>
					<For each={clients()}>
						{(c) => <option value={c.id}>{c.name}</option>}
					</For>
				</select>
				<select
					value={siteId()}
					onChange={(e) => setSiteId(e.currentTarget.value)}
					disabled={!clientId()}
					title={
						clientId() ? "Filter by site" : "Pick a client first"
					}
				>
					<option value="">All sites</option>
					<For each={sitesQuery.data ?? []}>
						{(s) => <option value={s.id}>{s.name}</option>}
					</For>
				</select>
			</div>

			<Show when={clientsQuery.isError}>
				<ErrorState
					message={`Could not load clients: ${toMessage(clientsQuery.error)}`}
					onRetry={() => clientsQuery.refetch()}
				/>
			</Show>
			<Show when={contactsQuery.isPending}>
				<LoadingState label="Loading people…" />
			</Show>
			<Show when={contactsQuery.isError}>
				<ErrorState
					message={`Could not load people: ${toMessage(contactsQuery.error)}`}
					onRetry={() => contactsQuery.refetch()}
				/>
			</Show>
			<Show when={contactsQuery.isSuccess && rows().length === 0}>
				<EmptyState
					title="No people found"
					hint="Try a different search or filter — or create the first person."
					action={
						<button
							type="button"
							class="btn btn-primary"
							onClick={() => {
								setEditing(null);
								setDrawerOpen(true);
							}}
						>
							<IconPlus size={15} /> New person
						</button>
					}
				/>
			</Show>
			<Show when={contactsQuery.isSuccess && rows().length > 0}>
				<Table columns={columns} rows={rows()} />
			</Show>

			<ContactDrawer
				open={drawerOpen()}
				contact={editing()}
				clients={clients()}
				onClose={() => {
					setDrawerOpen(false);
					setEditing(null);
				}}
			/>
		</main>
	);
};

export default PeoplePage;
