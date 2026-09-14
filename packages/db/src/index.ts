import { SQL } from "bun";
import { type BunSQLDatabase, drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema.js";

const connectionString =
	process.env.DATABASE_URL ?? "postgres://conex:conex@localhost:5432/conex";

let _client: SQL | null = null;
let _db: BunSQLDatabase<typeof schema> | null = null;

export function getClient(): SQL {
	if (!_client) _client = new SQL(connectionString, { max: 10 });
	return _client;
}

export function getDb() {
	if (!_db) _db = drizzle(getClient(), { schema });
	return _db;
}

export const db = new Proxy({} as ReturnType<typeof getDb>, {
	get(_t, prop) {
		return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
	},
});

export { schema };
export const sql = (strings: TemplateStringsArray, ...values: unknown[]) =>
	getClient()(strings, ...(values as never[]));
