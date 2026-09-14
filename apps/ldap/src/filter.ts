// LDAP search filter evaluation against in-memory entries (RFC 4515
// semantics for the subset Agfeo TK uses: AND/OR/NOT, equality,
// substrings, presence, ordering). Phone attributes additionally match on
// digit-normalized values so "(telephoneNumber=*123*)" finds "+49 30 123".
export type FilterNode =
  | { type: "and"; children: FilterNode[] }
  | { type: "or"; children: FilterNode[] }
  | { type: "not"; child: FilterNode }
  | { type: "equality"; attribute: string; value: string }
  | {
      type: "substrings";
      attribute: string;
      initial: string | null;
      any: string[];
      final: string | null;
    }
  | { type: "present"; attribute: string }
  | { type: "gte"; attribute: string; value: string }
  | { type: "lte"; attribute: string; value: string }
  | { type: "approx"; attribute: string; value: string };

export type EntryAttributes = Record<string, string[]>;

/** Attributes matched on digits only (incoming caller-name lookup). */
const PHONE_ATTRS = new Set(["telephonenumber", "mobile"]);

/** Strip everything but digits: "+49 30 123" -> "4930123". */
export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

function lookup(entry: EntryAttributes, attribute: string): string[] {
  const want = attribute.toLowerCase();
  for (const [key, values] of Object.entries(entry)) {
    if (key.toLowerCase() === want) return values;
  }
  return [];
}

function equalityMatch(
  attribute: string,
  assertion: string,
  values: string[],
): boolean {
  const want = assertion.toLowerCase();
  for (const v of values) {
    if (v.toLowerCase() === want) return true;
    if (PHONE_ATTRS.has(attribute.toLowerCase())) {
      const digitsValue = normalizePhone(v);
      const digitsAssertion = normalizePhone(assertion);
      if (digitsValue && digitsAssertion && digitsValue === digitsAssertion)
        return true;
    }
  }
  return false;
}

function orderedMatch(
  haystack: string,
  initial: string | null,
  anyParts: string[],
  final: string | null,
): boolean {
  const h = haystack.toLowerCase();
  let pos = 0;
  if (initial) {
    const needle = initial.toLowerCase();
    if (!h.startsWith(needle)) return false;
    pos = needle.length;
  }
  for (const part of anyParts) {
    const needle = part.toLowerCase();
    if (!needle) continue;
    const idx = h.indexOf(needle, pos);
    if (idx < 0) return false;
    pos = idx + needle.length;
  }
  if (final) {
    const needle = final.toLowerCase();
    if (!h.endsWith(needle)) return false;
    if (h.lastIndexOf(needle) < pos) return false;
  }
  return true;
}

function substringMatch(
  attribute: string,
  initial: string | null,
  anyParts: string[],
  final: string | null,
  values: string[],
): boolean {
  const isPhone = PHONE_ATTRS.has(attribute.toLowerCase());
  for (const v of values) {
    if (!isPhone) {
      if (orderedMatch(v, initial, anyParts, final)) return true;
      continue;
    }
    const digits = normalizePhone(v);
    const dInitial = initial ? normalizePhone(initial) : null;
    const dAny = anyParts.map(normalizePhone);
    const dFinal = final ? normalizePhone(final) : null;
    const meaningful = [dInitial, ...dAny, dFinal].filter(
      (p): p is string => !!p && p.length > 0,
    );
    if (meaningful.length === 0) {
      // Query has no digits at all: fall back to raw string matching.
      if (orderedMatch(v, initial, anyParts, final)) return true;
      continue;
    }
    if (orderedMatch(digits, dInitial, dAny, dFinal)) return true;
  }
  return false;
}

function orderingMatch(
  values: string[],
  assertion: string,
  cmp: (c: number) => boolean,
): boolean {
  const want = assertion.toLowerCase();
  return values.some((v) => {
    const got = v.toLowerCase();
    const c = got < want ? -1 : got > want ? 1 : 0;
    return cmp(c);
  });
}

/** Evaluate a parsed filter against one entry's attributes. */
export function matchesFilter(
  entry: EntryAttributes,
  node: FilterNode,
): boolean {
  switch (node.type) {
    case "and":
      return node.children.every((c) => matchesFilter(entry, c));
    case "or":
      return node.children.some((c) => matchesFilter(entry, c));
    case "not":
      return !matchesFilter(entry, node.child);
    case "equality":
      return equalityMatch(
        node.attribute,
        node.value,
        lookup(entry, node.attribute),
      );
    case "approx":
      return equalityMatch(
        node.attribute,
        node.value,
        lookup(entry, node.attribute),
      );
    case "substrings":
      return substringMatch(
        node.attribute,
        node.initial,
        node.any,
        node.final,
        lookup(entry, node.attribute),
      );
    case "present": {
      const values = lookup(entry, node.attribute);
      return values.length > 0;
    }
    case "gte":
      return orderingMatch(
        lookup(entry, node.attribute),
        node.value,
        (c) => c >= 0,
      );
    case "lte":
      return orderingMatch(
        lookup(entry, node.attribute),
        node.value,
        (c) => c <= 0,
      );
  }
}
