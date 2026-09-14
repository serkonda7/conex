import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { clients } from "./routes/clients.js";
import { contacts } from "./routes/contacts.js";
import { health } from "./routes/health.js";
import { openapi } from "./routes/openapi.js";
import { placeholders } from "./routes/placeholders.js";

const app = new Hono();

app.use("*", logger());
app.use("/api/*", cors());

app.get("/", (c) => c.json({ name: "conex-api", version: "0.0.0" }));
app.route("/health", health);
app.route("/api/v1", placeholders);
app.route("/api/v1", clients);
app.route("/api/v1", contacts);
app.route("/api/v1", openapi);

// TODO(P0): mount remaining domain routers — tickets, devices, auth.
// Each module lives in src/routes/<domain>.ts with valibotValidator + rbac middleware.

const port = Number(process.env.PORT ?? 3001);

export default {
  port,
  fetch: app.fetch,
};

export type AppType = typeof app;
