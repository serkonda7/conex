import { and, eq } from "drizzle-orm";
import { getClient, getDb, schema } from "./index.js";

function displayName(
  firstName: string | null,
  lastName: string | null,
  fallback: string,
): string {
  const full = [firstName, lastName].filter(Boolean).join(" ").trim();
  return full || fallback;
}

// Local-dev seed: 2 clients + sites + contacts. Idempotent —
// re-running will not duplicate rows (unique name/slug/email guards).
async function main() {
  const db = getDb();

  const clientSeeds = [
    {
      name: "Acme Manufacturing",
      slug: "acme-manufacturing",
      status: "active" as const,
      billingEmail: "billing@acme.example",
      phone: "+49 30 123456",
      notes: "Seed client: production plant + HQ.",
    },
    {
      name: "Globex Retail",
      slug: "globex-retail",
      status: "onboarding" as const,
      billingEmail: "accounts@globex.example",
      phone: "+49 40 987654",
      notes: "Seed client: onboarding, rollout in progress.",
    },
  ];

  for (const c of clientSeeds) {
    await db.insert(schema.clients).values(c).onConflictDoNothing();
  }
  console.log("[seed] clients ok");

  const rows = await db.select().from(schema.clients);
  const bySlug = new Map(rows.map((r) => [r.slug, r]));

  const siteSeeds = [
    {
      slug: "acme-manufacturing",
      name: "Acme HQ",
      addressLine1: "Werkstraße 1",
      city: "Berlin",
      country: "DE",
      timezone: "Europe/Berlin",
      isPrimary: true,
    },
    {
      slug: "acme-manufacturing",
      name: "Acme Plant Nord",
      addressLine1: "Hafenweg 12",
      city: "Hamburg",
      country: "DE",
      timezone: "Europe/Berlin",
      isPrimary: false,
    },
    {
      slug: "globex-retail",
      name: "Globex Store 01",
      addressLine1: "Musterallee 5",
      city: "Hamburg",
      country: "DE",
      timezone: "Europe/Berlin",
      isPrimary: true,
    },
  ];

  for (const s of siteSeeds) {
    const client = bySlug.get(s.slug);
    if (!client) continue;
    const [existing] = await db
      .select({ id: schema.sites.id })
      .from(schema.sites)
      .where(
        and(
          eq(schema.sites.clientId, client.id),
          eq(schema.sites.name, s.name),
        ),
      )
      .limit(1);
    if (existing) continue;
    await db.insert(schema.sites).values({
      clientId: client.id,
      name: s.name,
      addressLine1: s.addressLine1,
      city: s.city,
      country: s.country,
      timezone: s.timezone,
      isPrimary: s.isPrimary,
    });
  }
  console.log("[seed] sites ok");

  const siteRows = await db.select().from(schema.sites);
  const acme = bySlug.get("acme-manufacturing");
  const globex = bySlug.get("globex-retail");
  const acmeHq = siteRows.find(
    (s) => s.clientId === acme?.id && s.name === "Acme HQ",
  );

  const contactSeeds = [
    {
      clientId: acme?.id ?? "",
      siteId: acmeHq?.id ?? null,
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada.lovelace@acme.example",
      phone: "+49 30 123457",
      mobile: "+49 170 111222",
      title: "IT Lead",
      isPrimary: true,
    },
    {
      clientId: acme?.id ?? "",
      siteId: null,
      firstName: "Grace",
      lastName: "Hopper",
      email: "grace.hopper@acme.example",
      phone: "+49 30 123458",
      mobile: null,
      title: "Plant Manager",
      isPrimary: false,
    },
    {
      clientId: globex?.id ?? "",
      siteId: null,
      firstName: "Alan",
      lastName: "Turing",
      email: "alan.turing@globex.example",
      phone: "+49 40 987655",
      mobile: "+49 170 333444",
      title: "Store Owner",
      isPrimary: true,
    },
  ];

  for (const c of contactSeeds) {
    if (!c.clientId) continue;
    const [existing] = await db
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(eq(schema.contacts.email, c.email))
      .limit(1);
    if (existing) continue;
    await db.insert(schema.contacts).values({
      clientId: c.clientId,
      siteId: c.siteId,
      firstName: c.firstName,
      lastName: c.lastName,
      name: displayName(c.firstName, c.lastName, c.email),
      email: c.email,
      phone: c.phone,
      mobile: c.mobile,
      title: c.title,
      isPrimary: c.isPrimary,
    });
  }
  console.log("[seed] contacts ok");

  await getClient().end();
}

await main();
