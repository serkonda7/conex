// CONEX LDAP bridge entrypoint: LDAP (Agfeo TK address book) + HTTP debug.
import { loadConfig } from "./config.js";
import { createProvider } from "./db.js";
import { createHttpApp, serveHttp } from "./http.js";
import { createLdapServer } from "./ldap-server.js";

const config = loadConfig();
const provider = createProvider(config);

const ldap = createLdapServer(provider, config);
ldap.on("error", (err) => {
	console.error(`[ldap] failed to listen on port ${config.ldapPort}: ${err}`);
	process.exit(1);
});
ldap.listen(config.ldapPort, () => {
	console.log(
		`[ldap] listening on :${config.ldapPort} (base ${config.baseDn})`,
	);
});

const app = createHttpApp(provider, config);
const http = serveHttp(app, config.httpPort);
http.on("error", (err) => {
	console.error(
		`[ldap:http] failed to listen on port ${config.httpPort}: ${err}`,
	);
	process.exit(1);
});
console.log(
	`[ldap:http] debug endpoint on :${config.httpPort} (/ldap/search?q=)`,
);

function shutdown(): void {
	ldap.close(() => console.log("[ldap] closed"));
	http.close(() => console.log("[ldap:http] closed"));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
