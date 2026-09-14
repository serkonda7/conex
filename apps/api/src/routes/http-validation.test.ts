import { describe, expect, test } from "bun:test";
import { clients } from "./clients.js";
import { contacts } from "./contacts.js";
import { openapi } from "./openapi.js";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("clients routes: request validation (no DB touched)", () => {
  test("POST /clients with empty body -> 400 JSON", async () => {
    const res = await clients.request("/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("Validation failed");
    expect(body.issues.length).toBeGreaterThan(0);
  });

  test("POST /clients with invalid email -> 400", async () => {
    const res = await clients.request("/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Acme", billingEmail: "nope" }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /clients?limit=abc -> 400", async () => {
    const res = await clients.request("/clients?limit=abc");
    expect(res.status).toBe(400);
  });

  test("GET /clients/:id with non-uuid -> 400", async () => {
    const res = await clients.request("/clients/not-a-uuid");
    expect(res.status).toBe(400);
  });

  test("POST /clients/:id/sites with empty name -> 400", async () => {
    const res = await clients.request(`/clients/${UUID}/sites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /clients/:id/contacts with no name -> 400", async () => {
    const res = await clients.request(`/clients/${UUID}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "x@y.zz" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("contacts routes: request validation (no DB touched)", () => {
  test("POST /contacts/:id/assign with empty body -> 400", async () => {
    const res = await contacts.request(`/contacts/${UUID}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("GET /contacts?clientId=bad -> 400", async () => {
    const res = await contacts.request("/contacts?clientId=bad");
    expect(res.status).toBe(400);
  });
});

describe("openapi stub", () => {
  test("GET /openapi.json lists client + contact endpoints", async () => {
    const res = await openapi.request("/openapi.json");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paths: Record<string, unknown> };
    for (const p of [
      "/api/v1/clients",
      "/api/v1/clients/{id}",
      "/api/v1/clients/{id}/sites",
      "/api/v1/clients/{id}/contacts",
      "/api/v1/contacts",
      "/api/v1/contacts/{id}",
      "/api/v1/contacts/{id}/assign",
    ]) {
      expect(body.paths[p]).toBeDefined();
    }
  });
});
