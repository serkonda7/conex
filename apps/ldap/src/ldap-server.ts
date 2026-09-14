// LDAP server for the Agfeo TK telephone system, built on plain node:net
// (no ldapjs dependency — ldapjs@3 client-side entry parsing is broken
// under the Bun runtime, verified 2026-09; the server side would pull in
// the same unmaintained ASN.1 stack, so this file speaks the small LDAPv3
// subset Agfeo needs directly: simple/anonymous bind, subtree search,
// unbind).
import { createServer, type Server, type Socket } from "node:net";
import {
  decodeMessage,
  encodeBindResponse,
  encodeSearchDone,
  encodeSearchEntry,
  type LdapMessage,
} from "./ber.js";
import { matchesFilter } from "./filter.js";
import { contactToEntry, isWithinScope } from "./mapping.js";
import type { ContactRow, LdapEntry } from "./types.js";

/** Supplies contacts; DB-backed in prod, in-memory in tests. */
export type ContactProvider = () => Promise<ContactRow[]>;

export interface LdapServerOptions {
  baseDn: string;
  bindDn: string;
  bindPassword: string;
  allowAnonymous: boolean;
  sizeLimit: number;
}

/** LDAP result codes (RFC 4511 §4.1.9) used by this bridge. */
export const ResultCode = {
  success: 0,
  operationsError: 1,
  protocolError: 2,
  sizeLimitExceeded: 4,
  invalidCredentials: 49,
  insufficientAccess: 50,
  noSuchObject: 32,
} as const;

function normalizeDn(dn: string): string {
  return dn.trim().toLowerCase();
}

/** Requested base is usable when it equals, contains, or is contained in our base DN. */
export function baseUsable(requestedBase: string, baseDn: string): boolean {
  const req = normalizeDn(requestedBase);
  const base = normalizeDn(baseDn);
  if (req === "" || req === base) return true;
  return base.endsWith(`,${req}`) || req.endsWith(`,${base}`);
}

function rootDseEntry(baseDn: string): LdapEntry {
  return {
    dn: "",
    attributes: {
      objectClass: ["top"],
      namingContexts: [baseDn],
      subschemaSubentry: [`cn=Subschema,${baseDn}`],
      vendorName: ["CONEX MSP"],
      supportedLDAPVersion: ["3"],
    },
  };
}

/** Keep only client-requested attributes (case-insensitive); null = all. */
export function selectAttributes(
  entry: LdapEntry,
  requested: string[],
): Array<{ type: string; values: string[] }> {
  if (requested.length === 0 || requested.some((a) => a === "*")) {
    return Object.entries(entry.attributes).map(([type, values]) => ({
      type,
      values,
    }));
  }
  const wanted = new Set(requested.map((a) => a.toLowerCase()));
  return Object.entries(entry.attributes)
    .filter(([type]) => wanted.has(type.toLowerCase()))
    .map(([type, values]) => ({ type, values }));
}

export function createLdapServer(
  provider: ContactProvider,
  options: LdapServerOptions,
): Server {
  const opts = { ...options };

  function checkBind(name: string, password: string): boolean {
    if (!name) return opts.allowAnonymous; // anonymous simple bind (empty DN)
    const want = normalizeDn(opts.bindDn);
    const got = normalizeDn(name);
    const rdn = want.split(",")[0] ?? want;
    if (got !== want && got !== rdn) return false;
    return password === opts.bindPassword;
  }

  async function handleSearch(
    socket: Socket,
    msg: Extract<LdapMessage, { kind: "searchRequest" }>,
  ): Promise<void> {
    // RootDSE probe (e.g. base "" scope base): helps LDAP browsers and
    // verifies connectivity without touching the database.
    if (msg.baseObject === "" && msg.scope === 0) {
      const root = rootDseEntry(opts.baseDn);
      if (matchesFilter(root.attributes, msg.filter)) {
        socket.write(
          encodeSearchEntry(
            msg.messageId,
            root.dn,
            selectAttributes(root, msg.attributes),
          ),
        );
      }
      socket.write(encodeSearchDone(msg.messageId, ResultCode.success, ""));
      return;
    }

    if (!baseUsable(msg.baseObject, opts.baseDn)) {
      socket.write(
        encodeSearchDone(
          msg.messageId,
          ResultCode.noSuchObject,
          `unknown base ${msg.baseObject}`,
        ),
      );
      return;
    }

    let contacts: ContactRow[];
    try {
      contacts = await provider();
    } catch (err) {
      console.error(`[ldap] contact provider failed: ${err}`);
      socket.write(
        encodeSearchDone(
          msg.messageId,
          ResultCode.operationsError,
          "database unavailable",
        ),
      );
      return;
    }

    const base = msg.baseObject === "" ? opts.baseDn : msg.baseObject;
    const entries = contacts.map((c) => contactToEntry(c, opts.baseDn));
    const matched = entries.filter(
      (e) =>
        isWithinScope(e.dn, base, msg.scope) &&
        matchesFilter(e.attributes, msg.filter),
    );
    const limit =
      msg.sizeLimit > 0
        ? Math.min(msg.sizeLimit, opts.sizeLimit)
        : opts.sizeLimit;
    const page = matched.slice(0, limit);
    for (const entry of page) {
      socket.write(
        encodeSearchEntry(
          msg.messageId,
          entry.dn,
          selectAttributes(entry, msg.attributes),
        ),
      );
    }
    socket.write(encodeSearchDone(msg.messageId, ResultCode.success, ""));
  }

  const server = createServer((socket) => {
    let bound = false;
    let buffer = Buffer.alloc(0);
    let processing = false;

    async function drain(): Promise<void> {
      if (processing) return;
      processing = true;
      try {
        for (;;) {
          let decoded: { message: LdapMessage; bytesRead: number } | null;
          try {
            decoded = decodeMessage(buffer);
          } catch (err) {
            console.error(
              `[ldap] malformed message, closing connection: ${err}`,
            );
            socket.destroy();
            return;
          }
          if (!decoded) return; // wait for more bytes
          buffer = buffer.subarray(decoded.bytesRead);
          await dispatch(decoded.message);
        }
      } finally {
        processing = false;
      }
    }

    async function dispatch(msg: LdapMessage): Promise<void> {
      switch (msg.kind) {
        case "bindRequest": {
          const ok = checkBind(msg.name, msg.password);
          if (ok) bound = true;
          socket.write(
            encodeBindResponse(
              msg.messageId,
              ok ? ResultCode.success : ResultCode.invalidCredentials,
              ok ? "" : "invalid credentials",
            ),
          );
          break;
        }
        case "searchRequest": {
          if (!opts.allowAnonymous && !bound) {
            socket.write(
              encodeSearchDone(
                msg.messageId,
                ResultCode.insufficientAccess,
                "bind required",
              ),
            );
            break;
          }
          await handleSearch(socket, msg);
          break;
        }
        case "unbind":
          socket.end();
          break;
        case "abandon":
          break; // searches run synchronously; nothing to abandon
        default:
          break; // responses never arrive on the server side
      }
    }

    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      void drain();
    });
    socket.on("error", () => {});
  });

  return server;
}
