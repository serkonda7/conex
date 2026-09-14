import { describe, expect, test } from "bun:test";
import { createHttpApp } from "./http.js";
import type { ContactProvider } from "./ldap-server.js";
import type { ContactRow } from "./types.js";

const CONTACTS: ContactRow[] = [
  {
    id: "1",
    name: "Max Mustermann",
    firstName: "Max",
    lastName: "Mustermann",
    email: "max@mustermann.example",
    phone: "+49 30 123456",
    mobile: "+49 170 111222",
    title: "Geschäftsführer",
    clientId: "c1",
    clientName: "Muster GmbH",
    clientSlug: "muster-gmbh",
    siteId: "s1",
    siteName: "Hauptstandort",
  },
];

const provider: ContactProvider = async () => CONTACTS;
const app = createHttpApp(provider, {
  baseDn: "dc=conex,dc=local",
  sizeLimit: 50,
});

describe("HTTP debug endpoint", () => {
  test("GET /health", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "ok",
      service: "ldap-bridge",
    });
  });

  test("GET /ldap/search?q= filters like the Agfeo filter", async () => {
    const res = await app.request("/ldap/search?q=Mustermann");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.data[0]?.dn).toBe(
      "cn=Max Mustermann,ou=muster-gmbh,dc=conex,dc=local",
    );
    expect(body.data[0]?.telephoneNumber).toBe("+49 30 123456");
  });

  test("digit-normalized phone query", async () => {
    const res = await app.request("/ldap/search?q=30123456");
    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(1);
  });

  test("empty query returns all, limit is capped", async () => {
    const res = await app.request("/ldap/search?limit=5");
    const body = (await res.json()) as { data: unknown[]; total: number };
    expect(body.total).toBe(1);
    expect(body.data).toHaveLength(1);
  });

  test("no match returns empty data", async () => {
    const res = await app.request("/ldap/search?q=zzz-no-such-person");
    const body = (await res.json()) as { data: unknown[]; total: number };
    expect(body.total).toBe(0);
    expect(body.data).toEqual([]);
  });
});
