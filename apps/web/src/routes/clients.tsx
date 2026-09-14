import { A, useNavigate } from "@solidjs/router";
import { StatusBadge, Table } from "@conex/ui";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { IconPencil, IconPlus, IconTrash } from "solid-tabler-icons";
import { createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import { ClientDrawer } from "../components/client-form.js";
import { SearchInput } from "../components/search-input.js";
import type { Col } from "../components/ui-helpers.js";
import { EmptyState, ErrorState, LoadingState } from "../components/ui-helpers.js";
import type { Client, ClientInput } from "../lib/api.js";
import { createClient, deleteClient, fetchClients, keys, toMessage } from "../lib/api.js";
import { useDebounced } from "../lib/use-debounced.js";
import { CLIENT_STATUSES } from "../lib/api.js";

const ClientsPage: Component = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = createSignal("");
  const [status, setStatus] = createSignal("");
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [serverError, setServerError] = createSignal<string | null>(null);
  const debounced = useDebounced(search);

  const listQuery = createQuery(() => ({
    queryKey: [...keys.clients, debounced(), status()] as const,
    queryFn: () =>
      fetchClients({ q: debounced() || undefined, status: status() || undefined }),
  }));

  const createMut = createMutation(() => ({
    mutationFn: (input: ClientInput) => createClient(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.clients });
      setServerError(null);
      setDrawerOpen(false);
    },
    onError: (e) => setServerError(toMessage(e)),
  }));

  const deleteMut = createMutation(() => ({
    mutationFn: (id: string) => deleteClient(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.clients }),
    onError: (e) => window.alert(toMessage(e)),
  }));

  const askDelete = (c: Client) => {
    if (window.confirm(`Delete client "${c.name}"? This cannot be undone.`)) {
      deleteMut.mutate(c.id);
    }
  };

  const columns: Col[] = [
    {
      key: "name",
      header: "Name",
      render: (row) => {
        const c = row as unknown as Client;
        return <A href={`/clients/${c.id}`}>{c.name}</A>;
      },
    },
    { key: "slug", header: "Slug" },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={String((row as unknown as Client).status)} />,
    },
    { key: "billing_email", header: "Billing email" },
    { key: "phone", header: "Phone" },
    {
      key: "actions",
      header: "Actions",
      render: (row) => {
        const c = row as unknown as Client;
        return (
          <span class="row-actions">
            <button
              type="button"
              class="btn btn-icon"
              title="Open / edit"
              onClick={() => navigate(`/clients/${c.id}`)}
            >
              <IconPencil size={15} />
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

  const rows = () => listQuery.data ?? [];

  return (
    <main class="page">
      <div class="page-header">
        <h1>
          Clients{" "}
          <span class="count">{listQuery.data ? `(${listQuery.data.length})` : ""}</span>
        </h1>
        <button
          type="button"
          class="btn btn-primary"
          onClick={() => {
            setServerError(null);
            setDrawerOpen(true);
          }}
        >
          <IconPlus size={15} /> New client
        </button>
      </div>

      <div class="toolbar">
        <SearchInput
          value={search()}
          onInput={setSearch}
          placeholder="Search clients…  (⌘K)"
        />
        <select value={status()} onChange={(e) => setStatus(e.currentTarget.value)}>
          <option value="">All statuses</option>
          {CLIENT_STATUSES.map((s) => (
            <option value={s}>{s}</option>
          ))}
        </select>
      </div>

      <Show when={listQuery.isPending}>
        <LoadingState label="Loading clients…" />
      </Show>
      <Show when={listQuery.isError}>
        <ErrorState
          message={`Could not load clients: ${toMessage(listQuery.error)}`}
          onRetry={() => listQuery.refetch()}
        />
      </Show>
      <Show when={listQuery.isSuccess && rows().length === 0}>
        <EmptyState
          title="No clients found"
          hint={
            search() || status()
              ? "Try a different search or status filter."
              : "Create your first customer to get started."
          }
          action={
            <button
              type="button"
              class="btn btn-primary"
              onClick={() => {
                setServerError(null);
                setDrawerOpen(true);
              }}
            >
              <IconPlus size={15} /> New client
            </button>
          }
        />
      </Show>
      <Show when={listQuery.isSuccess && rows().length > 0}>
        <Table columns={columns} rows={rows()} />
      </Show>

      <ClientDrawer
        open={drawerOpen()}
        saving={createMut.isPending}
        serverError={serverError()}
        onClose={() => setDrawerOpen(false)}
        onSubmit={(input) => createMut.mutateAsync(input)}
      />
    </main>
  );
};

export default ClientsPage;
