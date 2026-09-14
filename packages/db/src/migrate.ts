import { migrate } from "drizzle-orm/postgres-js/migrator";
import { getClient, getDb } from "./index.js";

// Runs every `./drizzle/*.sql` migration not yet recorded in
// `__drizzle_migrations`. Safe to re-run: exits 0 when there is
// nothing to apply or when no DATABASE_URL is configured (local
// scaffold / CI without postgres).
async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) {
		console.log("[@conex/db] DATABASE_URL not set, skipping migrate.");
		return;
	}
	const migrationsFolder = new URL("../drizzle", import.meta.url).pathname;
	console.log(`[@conex/db] Applying migrations from ${migrationsFolder} ...`);
	await migrate(getDb(), { migrationsFolder });
	console.log("[@conex/db] Migrations up to date.");
	await getClient().end();
}

await main();
