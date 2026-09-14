import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connect, type Socket } from "node:net";
import {
  decodeMessage,
  encodeBindRequest,
  encodeSearchRequest,
  encodeUnbindRequest,
  type LdapMessage,
} from "./ber.js";
import type { FilterNode } from "./filter.js";
import { type ContactProvider, createLdapServer } from "./ldap-server.js";
import type { ContactRow } from "./types.js";

const BASE = "dc=conex,dc=local";

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
  {
    id: "2",
    name: "Erika Schmidt",
    firstName: "Erika",
    lastName: "Schmidt",
    email: "erika@beispiel.example",
    phone: "+49 40 654321",
    mobile: null,
    title: "Buchhaltung",
    clientId: "c2",
    clientName: "Beispiel AG",
    clientSlug: "beispiel-ag",
    siteId: null,
    siteName: null,
  },
];

const provider: ContactProvider = async () => CONTACTS;

let port = 0;
const server = createLdapServer(provider, {
  baseDn: BASE,
  bindDn: "cn=admin,dc=conex,dc=local",
  bindPassword: "secret",
  allowAnonymous: true,
  sizeLimit: 50,
});

beforeAll(async () => {
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const addr = server.address();
  if (typeof addr === "object" && addr) port = addr.port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Minimal LDAP client over a real TCP socket. */
async function ldapRoundtrip(messages: Uint8Array[]): Promise<LdapMessage[]> {
  const socket: Socket = connect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("error", reject);
  });
  const received: LdapMessage[] = [];
  let buffer = Buffer.alloc(0);
  let done = false;
  const donePromise = new Promise<void>((resolve) => {
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const decoded = decodeMessage(buffer);
        if (!decoded) break;
        buffer = buffer.subarray(decoded.bytesRead);
        received.push(decoded.message);
        const last = decoded.message;
        if (last.kind === "bindResponse" || last.kind === "searchDone") {
          // Caller decides when the conversation is over; keep reading until closed.
        }
      }
    });
    socket.on("close", () => {
      done = true;
      resolve();
    });
  });
  for (const m of messages) socket.write(m);
  // Unbind at the end so the server closes the connection.
  socket.write(encodeUnbindRequest(99));
  await donePromise;
  void done;
  return received;
}

async function search(
  filter: FilterNode,
  attrs: string[] = [],
): Promise<LdapMessage[]> {
  return ldapRoundtrip([
    encodeBindRequest(1, "", ""),
    encodeSearchRequest(2, {
      baseObject: BASE,
      scope: 2,
      filter,
      attributes: attrs,
    }),
  ]);
}

describe("LDAP server (live TCP, mock provider)", () => {
  test("anonymous bind succeeds, wrong password fails", async () => {
    const anon = await ldapRoundtrip([encodeBindRequest(1, "", "")]);
    expect(anon[0]).toMatchObject({ kind: "bindResponse", resultCode: 0 });

    const bad = await ldapRoundtrip([
      encodeBindRequest(1, "cn=admin,dc=conex,dc=local", "wrong"),
    ]);
    expect(bad[0]).toMatchObject({ kind: "bindResponse", resultCode: 49 });

    const good = await ldapRoundtrip([
      encodeBindRequest(1, "cn=admin,dc=conex,dc=local", "secret"),
    ]);
    expect(good[0]).toMatchObject({ kind: "bindResponse", resultCode: 0 });
  });

  test("Agfeo address-book search by name", async () => {
    const res = await search({
      type: "or",
      children: [
        {
          type: "substrings",
          attribute: "cn",
          initial: null,
          any: ["Mustermann"],
          final: null,
        },
        {
          type: "substrings",
          attribute: "sn",
          initial: null,
          any: ["Mustermann"],
          final: null,
        },
        {
          type: "substrings",
          attribute: "telephoneNumber",
          initial: null,
          any: ["Mustermann"],
          final: null,
        },
      ],
    });
    const entries = res.filter((m) => m.kind === "searchEntry");
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    if (entry.kind !== "searchEntry") throw new Error("unreachable");
    expect(entry.dn).toBe("cn=Max Mustermann,ou=muster-gmbh,dc=conex,dc=local");
    expect(entry.attributes.telephoneNumber).toEqual(["+49 30 123456"]);
    expect(entry.attributes.displayName).toEqual(["Max Mustermann"]);
    expect(res[res.length - 1]).toMatchObject({
      kind: "searchDone",
      resultCode: 0,
    });
  });

  test("incoming-call lookup by phone number", async () => {
    const res = await search({
      type: "equality",
      attribute: "telephoneNumber",
      value: "+49 40 654321",
    });
    const entries = res.filter((m) => m.kind === "searchEntry");
    expect(entries).toHaveLength(1);
    if (entries[0]?.kind === "searchEntry") {
      expect(entries[0].attributes.displayName).toEqual(["Erika Schmidt"]);
    }
  });

  test("attribute selection is honored", async () => {
    const res = await search({ type: "present", attribute: "objectClass" }, [
      "telephoneNumber",
      "mobile",
      "displayName",
    ]);
    const entries = res.filter((m) => m.kind === "searchEntry");
    expect(entries.length).toBe(2);
    const allowed = new Set(["telephonenumber", "mobile", "displayname"]);
    for (const m of entries) {
      if (m.kind !== "searchEntry") continue;
      for (const key of Object.keys(m.attributes)) {
        expect(allowed.has(key.toLowerCase())).toBe(true);
      }
      expect(m.attributes.cn).toBeUndefined();
    }
  });

  test("unknown base DN returns noSuchObject", async () => {
    const socket = connect(port, "127.0.0.1");
    await new Promise<void>((r) => socket.on("connect", () => r()));
    const received: LdapMessage[] = [];
    let buffer = Buffer.alloc(0);
    const closed = new Promise<void>((r) => socket.on("close", () => r()));
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const d = decodeMessage(buffer);
        if (!d) break;
        buffer = buffer.subarray(d.bytesRead);
        received.push(d.message);
      }
    });
    socket.write(
      encodeSearchRequest(5, {
        baseObject: "dc=other,dc=example",
        filter: { type: "present", attribute: "objectClass" },
      }),
    );
    socket.write(encodeUnbindRequest(99));
    await closed;
    expect(received[received.length - 1]).toMatchObject({
      kind: "searchDone",
      resultCode: 32,
    });
  });
});
