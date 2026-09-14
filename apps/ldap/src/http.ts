// HTTP debug mirror of the LDAP address book: GET /ldap/search?q=...
// Lets admins and tests verify the contact mapping without an LDAP client.
// Served by the ldap service itself (default port 3002) so apps/api stays
// untouched; Agfeo TK itself always uses the LDAP port.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { Hono } from "hono";
import type { ContactProvider } from "./ldap-server.js";
import { contactToEntry } from "./mapping.js";
import type { ContactRow } from "./types.js";

export interface HttpOptions {
	baseDn: string;
	sizeLimit: number;
}

function flatten(
	attributes: Record<string, string[]>,
): Record<string, string | string[]> {
	const out: Record<string, string | string[]> = {};
	for (const [key, values] of Object.entries(attributes)) {
		out[key] = values.length === 1 ? (values[0] ?? "") : values;
	}
	return out;
}

export function createHttpApp(
	provider: ContactProvider,
	opts: HttpOptions,
): Hono {
	const app = new Hono();

	app.get("/health", (c) =>
		c.json({
			status: "ok",
			service: "ldap-bridge",
			time: new Date().toISOString(),
		}),
	);

	// GET /ldap/search?q=muster&limit=10 — substring match across every
	// mapped attribute plus digit-normalized phone matching, same semantics
	// as the LDAP (|(cn=*q*)(sn=*q*)(telephoneNumber=*q*)) filter.
	app.get("/ldap/search", async (c) => {
		const q = (c.req.query("q") ?? "").trim();
		const rawLimit = Number(c.req.query("limit") ?? opts.sizeLimit);
		const limit = Math.min(
			Number.isFinite(rawLimit) && rawLimit > 0
				? Math.floor(rawLimit)
				: opts.sizeLimit,
			opts.sizeLimit,
		);
		let contacts: ContactRow[];
		try {
			contacts = await provider();
		} catch (err) {
			console.error(`[ldap:http] contact provider failed: ${err}`);
			return c.json({ error: "database unavailable" }, 503);
		}
		const qLower = q.toLowerCase();
		const qDigits = q.replace(/\D/g, "");
		const matched = contacts
			.map((contact) => contactToEntry(contact, opts.baseDn))
			.filter((entry) => {
				if (!q) return true;
				return Object.entries(entry.attributes).some(([attr, values]) =>
					values.some((v) => {
						if (v.toLowerCase().includes(qLower)) return true;
						const a = attr.toLowerCase();
						if (
							qDigits &&
							(a === "telephonenumber" || a === "mobile")
						) {
							return v.replace(/\D/g, "").includes(qDigits);
						}
						return false;
					}),
				);
			});
		const page = matched.slice(0, limit);
		return c.json({
			data: page.map((e) => ({ dn: e.dn, ...flatten(e.attributes) })),
			total: matched.length,
		});
	});

	return app;
}

/** Minimal node:http adapter for a Hono app (no extra deps, Bun+Node safe). */
export function serveHttp(app: Hono, port: number): Server {
	const server = createServer((req: IncomingMessage, res) => {
		void (async () => {
			try {
				const host = req.headers.host ?? `127.0.0.1:${port}`;
				const url = new URL(
					req.url ?? "/",
					`http://${host}`,
				).toString();
				const request = new Request(url, {
					method: req.method ?? "GET",
					headers: req.headers as Record<string, string>,
				});
				const response = await app.fetch(request);
				const headers: Record<string, string> = {};
				response.headers.forEach((value, key) => {
					headers[key] = value;
				});
				const body = Buffer.from(await response.arrayBuffer());
				res.writeHead(response.status, headers);
				res.end(body);
			} catch (err) {
				console.error(`[ldap:http] request failed: ${err}`);
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "internal error" }));
			}
		})();
	});
	server.listen(port);
	return server;
}
