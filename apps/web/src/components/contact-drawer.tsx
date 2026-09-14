import { Drawer } from "@conex/ui";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { Client, Contact, ContactInput, ContactPatch } from "../lib/api.js";
import {
  assignContact,
  contactClientId,
  contactSiteId,
  createContact,
  fetchSites,
  keys,
  toMessage,
  updateContact,
} from "../lib/api.js";
import { hasErrors, validateContact } from "../lib/validation.js";
import { Field } from "./ui-helpers.js";

export type ContactFormValues = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  mobile: string;
  title: string;
  clientId: string;
  siteId: string;
  is_primary: boolean;
};

function toValues(c?: Contact | null, defaultClientId?: string): ContactFormValues {
  return {
    first_name: c?.first_name ?? "",
    last_name: c?.last_name ?? "",
    email: c?.email ?? "",
    phone: c?.phone ?? "",
    mobile: c?.mobile ?? "",
    title: c?.title ?? "",
    clientId: contactClientId(c ?? ({} as Contact)) || defaultClientId || "",
    siteId: contactSiteId(c ?? ({} as Contact)) || "",
    is_primary: c?.is_primary ?? false,
  };
}

function clientName(clients: Client[], id: string): string {
  return clients.find((c) => c.id === id)?.name ?? id;
}

/**
 * Controlled create/edit form for a person. Client + site selects are
 * always rendered (site options follow the selected client).
 */
export function ContactForm(props: {
  initial?: Contact | null;
  defaultClientId?: string;
  clients: Client[];
  saving?: boolean;
  serverError?: string | null;
  submitLabel?: string;
  onSubmit: (values: ContactInput, siteTouched: boolean) => Promise<unknown> | unknown;
}): JSX.Element {
  const [values, setValues] = createSignal<ContactFormValues>(
    toValues(props.initial, props.defaultClientId),
  );
  const [errors, setErrors] = createSignal<Record<string, string | undefined>>({});
  const [syncedKey, setSyncedKey] = createSignal<string | undefined>(undefined);

  createEffect(() => {
    const key = `${props.initial?.id ?? "new"}@${props.defaultClientId ?? ""}`;
    if (key !== syncedKey()) {
      setSyncedKey(key);
      setValues(toValues(props.initial, props.defaultClientId));
      setErrors({});
    }
  });

  const sitesQuery = createQuery(() => ({
    queryKey: keys.sites(values().clientId || "none"),
    queryFn: () =>
      values().clientId ? fetchSites(values().clientId) : Promise.resolve([]),
  }));

  const set = (key: keyof ContactFormValues, value: string | boolean) =>
    setValues((v) => ({ ...v, [key]: value }) as ContactFormValues);

  const submit = async (e: Event) => {
    e.preventDefault();
    const v = values();
    const errs = validateContact(v);
    setErrors(errs);
    if (hasErrors(errs)) return;
    const input: ContactInput = {
      first_name: v.first_name.trim(),
      last_name: v.last_name.trim(),
      clientId: v.clientId,
      is_primary: v.is_primary,
    };
    if (v.email.trim()) input.email = v.email.trim();
    if (v.phone.trim()) input.phone = v.phone.trim();
    if (v.mobile.trim()) input.mobile = v.mobile.trim();
    if (v.title.trim()) input.title = v.title.trim();
    if (v.siteId) input.siteId = v.siteId;
    await props.onSubmit(input, true);
  };

  const v = values;
  const sites = () => sitesQuery.data ?? [];
  return (
    <form class="form" onSubmit={submit} novalidate>
      <Show when={props.serverError}>
        <p class="server-error" role="alert">
          {props.serverError}
        </p>
      </Show>
      <div class="grid-2">
        <Field label="First name" error={errors()["first_name"]}>
          <input
            class="input"
            value={v().first_name}
            onInput={(e) => set("first_name", e.currentTarget.value)}
            placeholder="Ada"
          />
        </Field>
        <Field label="Last name" error={errors()["last_name"]}>
          <input
            class="input"
            value={v().last_name}
            onInput={(e) => set("last_name", e.currentTarget.value)}
            placeholder="Lovelace"
          />
        </Field>
      </div>
      <Field label="Email" error={errors()["email"]}>
        <input
          class="input"
          type="email"
          value={v().email}
          onInput={(e) => set("email", e.currentTarget.value)}
          placeholder="ada@example.com"
        />
      </Field>
      <div class="grid-2">
        <Field label="Phone" error={errors()["phone"]}>
          <input
            class="input"
            type="tel"
            value={v().phone}
            onInput={(e) => set("phone", e.currentTarget.value)}
          />
        </Field>
        <Field label="Mobile" error={errors()["mobile"]}>
          <input
            class="input"
            type="tel"
            value={v().mobile}
            onInput={(e) => set("mobile", e.currentTarget.value)}
          />
        </Field>
      </div>
      <Field label="Title">
        <input
          class="input"
          value={v().title}
          onInput={(e) => set("title", e.currentTarget.value)}
          placeholder="IT admin"
        />
      </Field>
      <Field label="Client" error={errors()["clientId"]}>
        <select
          value={v().clientId}
          onChange={(e) => {
            set("clientId", e.currentTarget.value);
            set("siteId", "");
          }}
        >
          <option value="">Select client…</option>
          <For each={props.clients}>
            {(c) => <option value={c.id}>{c.name}</option>}
          </For>
        </select>
      </Field>
      <Field label="Site" hint={sitesQuery.isLoading ? "Loading sites…" : "Optional."}>
        <select
          value={v().siteId}
          onChange={(e) => set("siteId", e.currentTarget.value)}
          disabled={!v().clientId}
        >
          <option value="">No site</option>
          <For each={sites()}>{(s) => <option value={s.id}>{s.name}</option>}</For>
        </select>
      </Field>
      <label class="check-row">
        <input
          type="checkbox"
          checked={v().is_primary}
          onChange={(e) => set("is_primary", e.currentTarget.checked)}
        />
        <span>Primary contact</span>
      </label>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" disabled={props.saving}>
          {props.saving ? "Saving…" : (props.submitLabel ?? "Save person")}
        </button>
      </div>
    </form>
  );
}

/**
 * Create/edit drawer for a person, including the assign (move) control
 * that relocates the person to another client/site via
 * POST /contacts/:id/assign.
 */
export function ContactDrawer(props: {
  open: boolean;
  contact?: Contact | null;
  defaultClientId?: string;
  clients: Client[];
  onClose: () => void;
  onSaved?: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const [saveError, setSaveError] = createSignal<string | null>(null);
  const [assignError, setAssignError] = createSignal<string | null>(null);
  const [moveClientId, setMoveClientId] = createSignal("");
  const [moveSiteId, setMoveSiteId] = createSignal("");

  const editing = () => props.contact ?? null;

  // Preselect the move-targets with the person's current placement.
  createEffect(() => {
    if (props.open) {
      const c = editing();
      setSaveError(null);
      setAssignError(null);
      setMoveClientId(contactClientId(c ?? ({} as Contact)) || props.defaultClientId || "");
      setMoveSiteId(contactSiteId(c ?? ({} as Contact)) || "");
    }
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: keys.contacts() });
    qc.invalidateQueries({ queryKey: keys.clients });
  };

  const saveMut = createMutation(() => ({
    mutationFn: async (input: ContactInput) => {
      const current = editing();
      if (current) {
        const patch: ContactPatch = { ...input };
        return updateContact(current.id, patch);
      }
      return createContact(input);
    },
    onSuccess: () => {
      invalidate();
      props.onSaved?.();
      props.onClose();
    },
    onError: (e) => setSaveError(toMessage(e)),
  }));

  const moveSitesQuery = createQuery(() => ({
    queryKey: keys.sites(moveClientId() || "none"),
    queryFn: () =>
      moveClientId() ? fetchSites(moveClientId()) : Promise.resolve([]),
    enabled: props.open && !!moveClientId(),
  }));

  const assignMut = createMutation(() => ({
    mutationFn: () => {
      const current = editing();
      if (!current) throw new Error("Save the person before moving them.");
      return assignContact(current.id, {
        clientId: moveClientId(),
        siteId: moveSiteId() || null,
      });
    },
    onSuccess: () => {
      invalidate();
      props.onSaved?.();
      props.onClose();
    },
    onError: (e) => setAssignError(toMessage(e)),
  }));

  const moveSites = () => moveSitesQuery.data ?? [];

  return (
    <Drawer open={props.open} onClose={props.onClose}>
      <h2>{editing() ? "Edit person" : "New person"}</h2>
      <Show when={props.open}>
        <ContactForm
          initial={editing()}
          defaultClientId={props.defaultClientId}
          clients={props.clients}
          saving={saveMut.isPending}
          serverError={saveError()}
          submitLabel={editing() ? "Save changes" : "Create person"}
          onSubmit={(input) => saveMut.mutateAsync(input)}
        />
      </Show>
      <Show when={editing()}>
        <hr class="divider" />
        <h3>Move to another client / site</h3>
        <Show when={assignError()}>
          <p class="server-error" role="alert">
            {assignError()}
          </p>
        </Show>
        <div class="form">
          <Field label="Target client">
            <select
              value={moveClientId()}
              onChange={(e) => {
                setMoveClientId(e.currentTarget.value);
                setMoveSiteId("");
              }}
            >
              <option value="">Select client…</option>
              <For each={props.clients}>
                {(c) => <option value={c.id}>{c.name}</option>}
              </For>
            </select>
          </Field>
          <Field label="Target site">
            <select
              value={moveSiteId()}
              onChange={(e) => setMoveSiteId(e.currentTarget.value)}
              disabled={!moveClientId()}
            >
              <option value="">No site</option>
              <For each={moveSites()}>{(s) => <option value={s.id}>{s.name}</option>}</For>
            </select>
          </Field>
          <div class="form-actions">
            <button
              type="button"
              class="btn"
              disabled={assignMut.isPending || !moveClientId()}
              onClick={() => assignMut.mutate()}
            >
              {assignMut.isPending
                ? "Moving…"
                : `Move${moveClientId() ? ` to ${clientName(props.clients, moveClientId())}` : ""}`}
            </button>
          </div>
        </div>
      </Show>
    </Drawer>
  );
}
