import type { Context, Next } from "hono";

// Hono middleware stub. Verifies the better-auth session cookie in P0;
// currently passes through so scaffold health checks work.
export async function requireAuth(_c: Context, next: Next) {
	// TODO(P0): const session = await auth.api.getSession({ headers: c.req.raw.headers });
	// if (!session?.user) return c.json({ error: "unauthorized" }, 401);
	// c.set("user", session.user);
	await next();
}
