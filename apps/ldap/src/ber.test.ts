import { describe, expect, test } from "bun:test";
import {
	decodeMessage,
	encodeBindRequest,
	encodeSearchRequest,
	encodeUnbindRequest,
} from "./ber.js";
import type { FilterNode } from "./filter.js";

const BASE = "dc=conex,dc=local";

describe("BER codec", () => {
	test("bind request roundtrip (incl. anonymous)", () => {
		for (const [dn, pw] of [
			["cn=admin,dc=conex,dc=local", "secret"],
			["", ""],
		] as const) {
			const wire = encodeBindRequest(1, dn, pw);
			const decoded = decodeMessage(wire);
			expect(decoded?.bytesRead).toBe(wire.length);
			expect(decoded?.message).toEqual({
				kind: "bindRequest",
				messageId: 1,
				version: 3,
				name: dn,
				password: pw,
			});
		}
	});

	test("Agfeo-style search request roundtrip", () => {
		const filter: FilterNode = {
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
		};
		const wire = encodeSearchRequest(7, {
			baseObject: BASE,
			scope: 2,
			filter,
			attributes: ["cn", "telephoneNumber"],
		});
		const decoded = decodeMessage(wire);
		expect(decoded?.bytesRead).toBe(wire.length);
		expect(decoded?.message).toEqual({
			kind: "searchRequest",
			messageId: 7,
			baseObject: BASE,
			scope: 2,
			derefAliases: 0,
			sizeLimit: 0,
			timeLimit: 0,
			typesOnly: false,
			filter,
			attributes: ["cn", "telephoneNumber"],
		});
	});

	test("nested AND/NOT/equality/presence roundtrip", () => {
		const filter: FilterNode = {
			type: "and",
			children: [
				{
					type: "equality",
					attribute: "objectClass",
					value: "inetOrgPerson",
				},
				{ type: "not", child: { type: "present", attribute: "pager" } },
				{
					type: "substrings",
					attribute: "sn",
					initial: "Mu",
					any: ["ster"],
					final: "nn",
				},
			],
		};
		const decoded = decodeMessage(
			encodeSearchRequest(2, { baseObject: BASE, filter }),
		);
		if (decoded?.message.kind !== "searchRequest")
			throw new Error("search decode failed");
		expect(decoded.message.filter).toEqual(filter);
	});

	test("unbind roundtrip", () => {
		const decoded = decodeMessage(encodeUnbindRequest(3));
		expect(decoded?.message).toEqual({ kind: "unbind", messageId: 3 });
	});

	test("incomplete buffer returns null (waits for more bytes)", () => {
		const wire = encodeSearchRequest(1, {
			baseObject: BASE,
			filter: { type: "present", attribute: "objectClass" },
		});
		expect(decodeMessage(wire.subarray(0, 1))).toBeNull();
		expect(decodeMessage(wire.subarray(0, 5))).toBeNull();
		expect(decodeMessage(wire.subarray(0, wire.length - 1))).toBeNull();
		expect(decodeMessage(wire)?.bytesRead).toBe(wire.length);
	});

	test("two pipelined messages decode back-to-back", () => {
		const a = encodeBindRequest(1, "", "");
		const b = encodeSearchRequest(2, {
			baseObject: BASE,
			filter: { type: "present", attribute: "objectClass" },
		});
		const both = Buffer.concat([a, b]);
		const first = decodeMessage(both);
		expect(first?.message.kind).toBe("bindRequest");
		const second = decodeMessage(both.subarray(first?.bytesRead ?? 0));
		expect(second?.message.kind).toBe("searchRequest");
	});
});
