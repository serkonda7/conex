import { betterAuth } from "better-auth";

// Placeholder staff-only config for MVP. Other agents will wire
// drizzle adapter + session storage per ARCHITECTURE.md §2/§3.
export const auth = betterAuth({
	secret:
		process.env.BETTER_AUTH_SECRET ??
		"dev-secret-change-me-at-least-32-chars",
	baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
	emailAndPassword: { enabled: true },
});
