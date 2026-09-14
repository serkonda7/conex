/**
 * REST client + TanStack Query helpers for the assumed /api/v1 contract:
 *
 *   GET/POST          /api/v1/clients
 *   GET/PATCH/DELETE  /api/v1/clients/:id
 *   GET/POST          /api/v1/clients/:id/sites
 *   GET/POST          /api/v1/clients/:id/contacts
 *   GET               /api/v1/contacts?clientId&siteId&q
 *   GET/PATCH/DELETE  /api/v1/contacts/:id
 *   POST              /api/v1/contacts/:id/assign
 *
 * Backend field names (snake_case where the DB uses them) are preserved
 * verbatim; readers tolerate camelCase aliases via the helpers below.
 */

const BASE = "/api/v1";

export type ClientStatus = "active" | "onboarding" | "churned";
export const CLIENT_STATUSES: ClientStatus[] = ["active", "onboarding", "churned"];

export type Client = {
  id: string;
  name: string;
  slug: string;
  status: ClientStatus | string;
  billing_email?: string | null;
  phone?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type ClientInput = {
  name: string;
  slug: string;
  status: ClientStatus;
  billing_email?: string;
  phone?: string;
  notes?: string;
};
export type ClientPatch = Partial<ClientInput>;

export type Site = {
  id: string;
  client_id?: string | null;
  clientId?: string | null;
  name: string;
  address_line1?: string | null;
  city?: string | null;
  country?: string | null;
  timezone?: string | null;
  is_primary?: boolean | null;
  created_at?: string;
};

export type SiteInput = {
  name: string;
  address_line1?: string;
  city?: string;
  country?: string;
  timezone?: string;
  is_primary?: boolean;
};

export type Contact = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  /** Some backends return a single display name; preferred when present. */
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  title?: string | null;
  clientId?: string | null;
  client_id?: string | null;
  siteId?: string | null;
  site_id?: string | null;
  /** Optional denormalized labels (used when the API provides them). */
  client_name?: string | null;
  site_name?: string | null;
  is_primary?: boolean | null;
  created_at?: string;
};

export type ContactInput = {
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  mobile?: string;
  title?: string;
  clientId: string;
  siteId?: string | null;
  is_primary?: boolean;
};
export type ContactPatch = Partial<ContactInput>;
export type AssignInput = { clientId: string; siteId?: string | null };

export type ClientFilter = { q?: string; status?: string };
export type ContactFilter = { clientId?: string; siteId?: string; q?: string };

/** Query-key roots: ['clients'], ['contacts'] (plus ['sites'] for detail views). */
export const keys = {
  clients: ["clients"],
  client: (id: string) => ["clients", id] as const,
  sites: (clientId: string) => ["sites", clientId] as const,
  contacts: (f: ContactFilter = {}) =>
    ["contacts", f.clientId ?? null, f.siteId ?? null, f.q ?? null] as const,
  contact: (id: string) => ["contacts", id] as const,
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function toMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

function params(o: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v) sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    const body = (json ?? {}) as Record<string, unknown>;
    const msg =
      body["error"] ?? body["message"] ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, String(msg));
  }
  // Tolerate both `{ data: ... }` envelopes and bare payloads.
  if (json !== null && typeof json === "object" && "data" in json) {
    return (json as { data: T }).data;
  }
  return json as T;
}

/* ----- clients ----- */

export function fetchClients(f: ClientFilter = {}): Promise<Client[]> {
  return req<Client[]>(`/clients${params({ q: f.q, status: f.status })}`);
}

export function fetchClient(id: string): Promise<Client> {
  return req<Client>(`/clients/${id}`);
}

export function createClient(input: ClientInput): Promise<Client> {
  return req<Client>("/clients", { method: "POST", body: JSON.stringify(input) });
}

export function updateClient(id: string, patch: ClientPatch): Promise<Client> {
  return req<Client>(`/clients/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteClient(id: string): Promise<void> {
  await req<unknown>(`/clients/${id}`, { method: "DELETE" });
}

/* ----- sites ----- */

export function fetchSites(clientId: string): Promise<Site[]> {
  return req<Site[]>(`/clients/${clientId}/sites`);
}

export function createSite(clientId: string, input: SiteInput): Promise<Site> {
  return req<Site>(`/clients/${clientId}/sites`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* ----- contacts ----- */

export function fetchContacts(f: ContactFilter = {}): Promise<Contact[]> {
  if (f.clientId) {
    return req<Contact[]>(
      `/clients/${f.clientId}/contacts${params({ q: f.q, siteId: f.siteId })}`,
    );
  }
  return req<Contact[]>(
    `/contacts${params({ clientId: f.clientId, siteId: f.siteId, q: f.q })}`,
  );
}

export function fetchContact(id: string): Promise<Contact> {
  return req<Contact>(`/contacts/${id}`);
}

export function createContact(input: ContactInput): Promise<Contact> {
  const { clientId, ...rest } = input;
  const body = JSON.stringify({ ...rest, clientId });
  if (clientId) {
    return req<Contact>(`/clients/${clientId}/contacts`, {
      method: "POST",
      body,
    });
  }
  return req<Contact>("/contacts", { method: "POST", body });
}

export function updateContact(id: string, patch: ContactPatch): Promise<Contact> {
  return req<Contact>(`/contacts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteContact(id: string): Promise<void> {
  await req<unknown>(`/contacts/${id}`, { method: "DELETE" });
}

export function assignContact(id: string, assign: AssignInput): Promise<Contact> {
  return req<Contact>(`/contacts/${id}/assign`, {
    method: "POST",
    body: JSON.stringify(assign),
  });
}

/* ----- tolerant readers (snake_case <-> camelCase) ----- */

export const siteClientId = (s: Site): string => s.client_id ?? s.clientId ?? "";

export const contactClientId = (c: Contact): string =>
  c.clientId ?? c.client_id ?? "";

export const contactSiteId = (c: Contact): string | null =>
  c.siteId ?? c.site_id ?? null;

export function contactName(c: Contact): string {
  const full = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return c.name?.trim() || full || c.email || "Unnamed";
}
