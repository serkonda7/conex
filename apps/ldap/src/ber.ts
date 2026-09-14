// Minimal BER codec for the LDAPv3 subset this bridge needs (RFC 4511):
// bind + search requests, bind/search responses, unbind, abandon.
// Only definite-form lengths and single-octet tags are supported, which is
// what Agfeo TK and every mainstream LDAP client sends.
import type { FilterNode } from "./filter.js";

export class BerTruncated extends Error {}
export class BerError extends Error {}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeLength(len: number): Uint8Array {
  if (len < 0x80) return new Uint8Array([len]);
  const octets: number[] = [];
  let v = len;
  while (v > 0) {
    octets.unshift(v % 256);
    v = Math.floor(v / 256);
  }
  return new Uint8Array([0x80 | octets.length, ...octets]);
}

function tlv(tag: number, content: Uint8Array): Uint8Array {
  const len = encodeLength(content.length);
  const out = new Uint8Array(1 + len.length + content.length);
  out[0] = tag;
  out.set(len, 1);
  out.set(content, 1 + len.length);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

function encodeNonNegativeInt(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0) throw new BerError(`bad integer ${n}`);
  if (n === 0) return new Uint8Array([0]);
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v % 256);
    v = Math.floor(v / 256);
  }
  if ((bytes[0] ?? 0) >= 0x80) bytes.unshift(0);
  return new Uint8Array(bytes);
}

const octet = (s: string | Uint8Array): Uint8Array =>
  tlv(0x04, typeof s === "string" ? encoder.encode(s) : s);
const integer = (n: number): Uint8Array => tlv(0x02, encodeNonNegativeInt(n));
const enumerated = (n: number): Uint8Array =>
  tlv(0x0a, encodeNonNegativeInt(n));
const bool = (b: boolean): Uint8Array =>
  tlv(0x01, new Uint8Array([b ? 0xff : 0x00]));
const seq = (content: Uint8Array, tag = 0x30): Uint8Array => tlv(tag, content);

// --- reader ---------------------------------------------------------------

export class BerReader {
  offset = 0;
  constructor(readonly buf: Uint8Array) {}
  get remaining(): number {
    return this.buf.length - this.offset;
  }
  peek(): number {
    if (this.offset >= this.buf.length) throw new BerTruncated("eof");
    return this.buf[this.offset] ?? 0;
  }
  readByte(): number {
    if (this.offset >= this.buf.length) throw new BerTruncated("eof");
    return this.buf[this.offset++] ?? 0;
  }
  readLength(): number {
    const first = this.readByte();
    if (first < 0x80) return first;
    const count = first & 0x7f;
    if (count === 0 || count > 4) throw new BerError("bad length octets");
    let len = 0;
    for (let i = 0; i < count; i++) len = len * 256 + this.readByte();
    return len;
  }
  /** Read one TLV; throws BerTruncated when the buffer ends mid-value. */
  readTLV(expectedTag?: number): { tag: number; value: Uint8Array } {
    const tag = this.readByte();
    if (expectedTag !== undefined && tag !== expectedTag) {
      throw new BerError(
        `expected tag 0x${expectedTag.toString(16)}, got 0x${tag.toString(16)}`,
      );
    }
    const len = this.readLength();
    if (this.offset + len > this.buf.length)
      throw new BerTruncated("value truncated");
    const value = this.buf.slice(this.offset, this.offset + len);
    this.offset += len;
    return { tag, value };
  }
}

function readInt(value: Uint8Array): number {
  let n = 0;
  for (const b of value) n = n * 256 + b;
  return n;
}

const readString = (value: Uint8Array): string => decoder.decode(value);

// --- LDAP messages ----------------------------------------------------------

export type LdapMessage =
  | {
      kind: "bindRequest";
      messageId: number;
      version: number;
      name: string;
      password: string;
    }
  | {
      kind: "searchRequest";
      messageId: number;
      baseObject: string;
      scope: number;
      derefAliases: number;
      sizeLimit: number;
      timeLimit: number;
      typesOnly: boolean;
      filter: FilterNode;
      attributes: string[];
    }
  | { kind: "unbind"; messageId: number }
  | { kind: "abandon"; messageId: number; abandonId: number }
  | {
      kind: "bindResponse";
      messageId: number;
      resultCode: number;
      message: string;
    }
  | {
      kind: "searchEntry";
      messageId: number;
      dn: string;
      attributes: Record<string, string[]>;
    }
  | {
      kind: "searchDone";
      messageId: number;
      resultCode: number;
      message: string;
    };

function parseFilter(r: BerReader): FilterNode {
  const tag = r.peek();
  switch (tag) {
    case 0xa0:
    case 0xa1: {
      const { value } = r.readTLV();
      const inner = new BerReader(value);
      const children: FilterNode[] = [];
      while (inner.remaining > 0) children.push(parseFilter(inner));
      return { type: tag === 0xa0 ? "and" : "or", children };
    }
    case 0xa2: {
      const { value } = r.readTLV();
      const inner = new BerReader(value);
      const child = parseFilter(inner);
      if (inner.remaining !== 0)
        throw new BerError("trailing bytes in NOT filter");
      return { type: "not", child };
    }
    case 0xa3:
    case 0xa5:
    case 0xa6:
    case 0xa8: {
      const { value } = r.readTLV();
      const inner = new BerReader(value);
      const attribute = readString(inner.readTLV(0x04).value);
      const attrValue = readString(inner.readTLV(0x04).value);
      if (tag === 0xa3)
        return { type: "equality", attribute, value: attrValue };
      if (tag === 0xa5) return { type: "gte", attribute, value: attrValue };
      if (tag === 0xa6) return { type: "lte", attribute, value: attrValue };
      return { type: "approx", attribute, value: attrValue };
    }
    case 0xa4: {
      const { value } = r.readTLV();
      const inner = new BerReader(value);
      const attribute = readString(inner.readTLV(0x04).value);
      const subs = new BerReader(inner.readTLV(0x30).value);
      let initial: string | null = null;
      const any: string[] = [];
      let final: string | null = null;
      while (subs.remaining > 0) {
        const part = subs.readTLV();
        if (part.tag === 0x80) initial = readString(part.value);
        else if (part.tag === 0x81) any.push(readString(part.value));
        else if (part.tag === 0x82) final = readString(part.value);
        else
          throw new BerError(`bad substring choice 0x${part.tag.toString(16)}`);
      }
      if (initial === null && any.length === 0 && final === null) {
        return { type: "present", attribute };
      }
      return { type: "substrings", attribute, initial, any, final };
    }
    case 0x87: {
      const { value } = r.readTLV();
      return { type: "present", attribute: readString(value) };
    }
    case 0xa9: {
      // Extensible match: not needed for address-book use; degrade to an
      // equality on the attribute when one is given, else match-all via
      // (objectClass=*).
      const { value } = r.readTLV();
      const inner = new BerReader(value);
      let attribute: string | null = null;
      let matchValue: string | null = null;
      while (inner.remaining > 0) {
        const part = inner.readTLV();
        if (part.tag === 0x80) attribute = readString(part.value);
        else if (part.tag === 0x82) matchValue = readString(part.value);
      }
      if (attribute && matchValue !== null)
        return { type: "equality", attribute, value: matchValue };
      return { type: "present", attribute: "objectClass" };
    }
    default:
      throw new BerError(`unsupported filter tag 0x${tag.toString(16)}`);
  }
}

function parseSearchRequest(messageId: number, value: Uint8Array): LdapMessage {
  const r = new BerReader(value);
  const baseObject = readString(r.readTLV(0x04).value);
  const scope = readInt(r.readTLV(0x0a).value);
  const derefAliases = readInt(r.readTLV(0x0a).value);
  const sizeLimit = readInt(r.readTLV(0x02).value);
  const timeLimit = readInt(r.readTLV(0x02).value);
  const typesOnly = (r.readTLV(0x01).value[0] ?? 0) !== 0;
  const filter = parseFilter(r);
  const attrsReader = new BerReader(r.readTLV(0x30).value);
  const attributes: string[] = [];
  while (attrsReader.remaining > 0)
    attributes.push(readString(attrsReader.readTLV(0x04).value));
  return {
    kind: "searchRequest",
    messageId,
    baseObject,
    scope,
    derefAliases,
    sizeLimit,
    timeLimit,
    typesOnly,
    filter,
    attributes,
  };
}

function parseResult(
  tag: number,
  messageId: number,
  value: Uint8Array,
): LdapMessage {
  const r = new BerReader(value);
  const resultCode = readInt(r.readTLV(0x0a).value);
  r.readTLV(0x04); // matchedDN (ignored)
  const message = readString(r.readTLV(0x04).value);
  return tag === 0x61
    ? { kind: "bindResponse", messageId, resultCode, message }
    : { kind: "searchDone", messageId, resultCode, message };
}

function parseSearchEntry(messageId: number, value: Uint8Array): LdapMessage {
  const r = new BerReader(value);
  const dn = readString(r.readTLV(0x04).value);
  const attrsReader = new BerReader(r.readTLV(0x30).value);
  const attributes: Record<string, string[]> = {};
  while (attrsReader.remaining > 0) {
    const attr = new BerReader(attrsReader.readTLV(0x30).value);
    const type = readString(attr.readTLV(0x04).value);
    const vals = new BerReader(attr.readTLV(0x31).value);
    const values: string[] = [];
    while (vals.remaining > 0)
      values.push(readString(vals.readTLV(0x04).value));
    attributes[type] = values;
  }
  return { kind: "searchEntry", messageId, dn, attributes };
}

/**
 * Decode one LDAPMessage from the front of `buf`.
 * Returns null when fewer bytes than a full message are available.
 * Throws BerError on malformed (but complete) data.
 */
export function decodeMessage(
  buf: Uint8Array,
): { message: LdapMessage; bytesRead: number } | null {
  if (buf.length < 2) return null;
  const r = new BerReader(buf);
  let outer: { tag: number; value: Uint8Array };
  try {
    outer = r.readTLV(0x30);
  } catch (e) {
    if (e instanceof BerTruncated) return null;
    throw e;
  }
  const bytesRead = r.offset;
  const inner = new BerReader(outer.value);
  const messageId = readInt(inner.readTLV(0x02).value);
  const opTag = inner.peek();
  let message: LdapMessage;
  if (opTag === 0x60) {
    const body = new BerReader(inner.readTLV(0x60).value);
    const version = readInt(body.readTLV(0x02).value);
    const name = readString(body.readTLV(0x04).value);
    const auth = body.readTLV();
    if (auth.tag !== 0x80) throw new BerError("only simple bind is supported");
    message = {
      kind: "bindRequest",
      messageId,
      version,
      name,
      password: readString(auth.value),
    };
  } else if (opTag === 0x63) {
    message = parseSearchRequest(messageId, inner.readTLV(0x63).value);
  } else if (opTag === 0x42) {
    inner.readTLV(0x42);
    message = { kind: "unbind", messageId };
  } else if (opTag === 0x50) {
    message = {
      kind: "abandon",
      messageId,
      abandonId: readInt(inner.readTLV(0x50).value),
    };
  } else if (opTag === 0x61) {
    message = parseResult(0x61, messageId, inner.readTLV(0x61).value);
  } else if (opTag === 0x64) {
    message = parseSearchEntry(messageId, inner.readTLV(0x64).value);
  } else if (opTag === 0x65) {
    message = parseResult(0x65, messageId, inner.readTLV(0x65).value);
  } else {
    throw new BerError(`unsupported protocol op 0x${opTag.toString(16)}`);
  }
  return { message, bytesRead: bytesRead };
}

// --- encoders (requests: used by tests; responses: used by the server) ------

function encodeMessage(messageId: number, op: Uint8Array): Uint8Array {
  return seq(concat(integer(messageId), op));
}

export function encodeFilter(node: FilterNode): Uint8Array {
  switch (node.type) {
    case "and":
      return tlv(0xa0, concat(...node.children.map(encodeFilter)));
    case "or":
      return tlv(0xa1, concat(...node.children.map(encodeFilter)));
    case "not":
      return tlv(0xa2, encodeFilter(node.child));
    case "equality":
      return tlv(0xa3, concat(octet(node.attribute), octet(node.value)));
    case "gte":
      return tlv(0xa5, concat(octet(node.attribute), octet(node.value)));
    case "lte":
      return tlv(0xa6, concat(octet(node.attribute), octet(node.value)));
    case "approx":
      return tlv(0xa8, concat(octet(node.attribute), octet(node.value)));
    case "present":
      return tlv(0x87, encoder.encode(node.attribute));
    case "substrings": {
      const parts: Uint8Array[] = [];
      if (node.initial !== null)
        parts.push(tlv(0x80, encoder.encode(node.initial)));
      for (const a of node.any) parts.push(tlv(0x81, encoder.encode(a)));
      if (node.final !== null)
        parts.push(tlv(0x82, encoder.encode(node.final)));
      return tlv(0xa4, concat(octet(node.attribute), seq(concat(...parts))));
    }
  }
}

export function encodeBindRequest(
  messageId: number,
  dn: string,
  password: string,
): Uint8Array {
  return encodeMessage(
    messageId,
    tlv(
      0x60,
      concat(integer(3), octet(dn), tlv(0x80, encoder.encode(password))),
    ),
  );
}

export interface SearchRequestOptions {
  baseObject: string;
  scope?: number;
  filter: FilterNode;
  attributes?: string[];
  sizeLimit?: number;
}

export function encodeSearchRequest(
  messageId: number,
  opts: SearchRequestOptions,
): Uint8Array {
  return encodeMessage(
    messageId,
    tlv(
      0x63,
      concat(
        octet(opts.baseObject),
        enumerated(opts.scope ?? 2),
        enumerated(0),
        integer(opts.sizeLimit ?? 0),
        integer(0),
        bool(false),
        encodeFilter(opts.filter),
        seq(concat(...(opts.attributes ?? []).map((a) => octet(a)))),
      ),
    ),
  );
}

export function encodeUnbindRequest(messageId: number): Uint8Array {
  return encodeMessage(messageId, tlv(0x42, new Uint8Array(0)));
}

function encodeResult(
  opTag: 0x61 | 0x65,
  messageId: number,
  resultCode: number,
  message: string,
): Uint8Array {
  return encodeMessage(
    messageId,
    tlv(opTag, concat(enumerated(resultCode), octet(""), octet(message))),
  );
}

export function encodeBindResponse(
  messageId: number,
  resultCode: number,
  message = "",
): Uint8Array {
  return encodeResult(0x61, messageId, resultCode, message);
}

export function encodeSearchEntry(
  messageId: number,
  dn: string,
  attributes: Array<{ type: string; values: string[] }>,
): Uint8Array {
  const attrs = concat(
    ...attributes.map((a) =>
      seq(
        concat(
          octet(a.type),
          tlv(0x31, concat(...a.values.map((v) => octet(v)))),
        ),
      ),
    ),
  );
  return encodeMessage(messageId, tlv(0x64, concat(octet(dn), seq(attrs))));
}

export function encodeSearchDone(
  messageId: number,
  resultCode: number,
  message = "",
): Uint8Array {
  return encodeResult(0x65, messageId, resultCode, message);
}
