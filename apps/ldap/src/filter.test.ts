import { describe, expect, test } from "bun:test";
import { type FilterNode, matchesFilter, normalizePhone } from "./filter.js";

const ENTRY = {
  objectClass: ["top", "person", "organizationalPerson", "inetOrgPerson"],
  cn: ["Max Mustermann"],
  sn: ["Mustermann"],
  givenName: ["Max"],
  displayName: ["Max Mustermann"],
  mail: ["max@mustermann.example"],
  telephoneNumber: ["+49 30 123456"],
  mobile: ["+49 170 111222"],
  title: ["Geschäftsführer"],
  o: ["Muster GmbH"],
  company: ["Muster GmbH"],
  ou: ["Hauptstandort"],
};

/** Agfeo-style address-book filter for a free-text query. */
function agfeoFilter(q: string): FilterNode {
  const sub = (attribute: string): FilterNode => ({
    type: "substrings",
    attribute,
    initial: null,
    any: [q],
    final: null,
  });
  return {
    type: "or",
    children: [sub("cn"), sub("sn"), sub("telephoneNumber")],
  };
}

describe("matchesFilter", () => {
  test("Agfeo free-text filter matches name and phone", () => {
    expect(matchesFilter(ENTRY, agfeoFilter("Mustermann"))).toBe(true);
    expect(matchesFilter(ENTRY, agfeoFilter("max"))).toBe(true); // case-insensitive cn
    expect(matchesFilter(ENTRY, agfeoFilter("123456"))).toBe(true); // digits in phone
    expect(matchesFilter(ENTRY, agfeoFilter("30 1234"))).toBe(true); // formatted partial input
    expect(matchesFilter(ENTRY, agfeoFilter("Schmidt"))).toBe(false);
  });

  test("incoming-call lookup by exact phone number", () => {
    const f: FilterNode = {
      type: "equality",
      attribute: "telephoneNumber",
      value: "+49 30 123456",
    };
    expect(matchesFilter(ENTRY, f)).toBe(true);
    const normalized: FilterNode = {
      type: "equality",
      attribute: "telephoneNumber",
      value: "4930123456",
    };
    expect(matchesFilter(ENTRY, normalized)).toBe(true);
    const mobile: FilterNode = {
      type: "substrings",
      attribute: "mobile",
      initial: null,
      any: ["170111"],
      final: null,
    };
    expect(matchesFilter(ENTRY, mobile)).toBe(true);
  });

  test("AND / NOT / presence / objectClass", () => {
    expect(
      matchesFilter(ENTRY, {
        type: "and",
        children: [
          {
            type: "equality",
            attribute: "objectClass",
            value: "inetOrgPerson",
          },
          { type: "present", attribute: "mail" },
          {
            type: "not",
            child: { type: "equality", attribute: "sn", value: "Schmidt" },
          },
        ],
      }),
    ).toBe(true);
    expect(matchesFilter(ENTRY, { type: "present", attribute: "pager" })).toBe(
      false,
    );
    expect(
      matchesFilter(ENTRY, { type: "present", attribute: "objectClass" }),
    ).toBe(true);
  });

  test("substring anchors (initial/final)", () => {
    expect(
      matchesFilter(ENTRY, {
        type: "substrings",
        attribute: "sn",
        initial: "Must",
        any: [],
        final: null,
      }),
    ).toBe(true);
    expect(
      matchesFilter(ENTRY, {
        type: "substrings",
        attribute: "sn",
        initial: null,
        any: [],
        final: "mann",
      }),
    ).toBe(true);
    expect(
      matchesFilter(ENTRY, {
        type: "substrings",
        attribute: "sn",
        initial: "mann",
        any: [],
        final: null,
      }),
    ).toBe(false);
  });

  test("attribute matching is case-insensitive", () => {
    expect(
      matchesFilter(ENTRY, {
        type: "equality",
        attribute: "CN",
        value: "max mustermann",
      }),
    ).toBe(true);
  });

  test("normalizePhone", () => {
    expect(normalizePhone("+49 (0) 30 / 123-456")).toBe("49030123456");
  });
});
