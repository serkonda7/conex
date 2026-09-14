# @conex/ldap — LDAP address book bridge for Agfeo TK telephone systems

Exposes CONEX contacts (`contacts` JOIN `clients`/`sites`) as a standard
LDAP address book (`inetOrgPerson`) so an Agfeo TK phone system can:

- search contacts by name from the phone display, and
- resolve incoming caller numbers to names (reverse lookup by
  `telephoneNumber` / `mobile`).

No `ldapjs` dependency: the service speaks the LDAPv3 subset Agfeo needs
(simple/anonymous bind, subtree search, unbind) directly over `node:net`
with a minimal hand-rolled BER codec. (`ldapjs@3.0.7` was evaluated under
the Bun runtime on 2026-09: the server accepts filters, but client-side
search-entry parsing returns empty objects, i.e. entries lose DN and
attributes. The zero-dependency implementation avoids that unmaintained
ASN.1 stack entirely and is covered by protocol round-trip tests.)

## Layout

```
src/
  index.ts       # entrypoint: LDAP :1389 + HTTP debug :3002
  config.ts      # env config (LDAP_BASE_DN, LDAP_BIND_DN/PASSWORD, ...)
  ber.ts         # minimal BER codec + LDAP message encode/decode
  filter.ts      # search-filter evaluation (AND/OR/NOT, equality,
                 #   substrings, presence; digit-normalized phone match)
  mapping.ts     # contacts -> inetOrgPerson entries
  ldap-server.ts # node:net LDAP server
  db.ts          # Postgres provider (drizzle, via @conex/db) / mock file
  http.ts        # Hono debug app: GET /health, GET /ldap/search?q=
```

## Configuration (env)

| Var | Default | Meaning |
| --- | ------- | ------- |
| `LDAP_BASE_DN` | `dc=conex,dc=local` | Search base for all entries |
| `LDAP_BIND_DN` | `cn=admin,dc=conex,dc=local` | Service bind DN (`cn=admin` short form also accepted) |
| `LDAP_BIND_PASSWORD` | `secret` | Service bind password (**change in production**) |
| `LDAP_ALLOW_ANONYMOUS` | `true` | Allow anonymous simple bind + read (Agfeo default setup) |
| `LDAP_PORT` | `1389` | LDAP listen port (mapped to 389 in docker-compose) |
| `LDAP_HTTP_PORT` | `3002` | HTTP debug endpoint port |
| `LDAP_SIZE_LIMIT` | `50` | Max entries per search response |
| `DATABASE_URL` | — | Postgres connection string |
| `LDAP_MOCK_FILE` | — | JSON `ContactRow[]` used instead of Postgres (tests/demo) |

## LDAP schema mapping

One entry per contact:

```
dn: cn=<name>,ou=<client-slug>,<BASE_DN>
```

| LDAP attribute | Source | Notes |
| -------------- | ------ | ----- |
| `objectClass` | — | `top`, `person`, `organizationalPerson`, `inetOrgPerson` |
| `cn` | `contacts.name` | full display name |
| `sn` | `contacts.last_name` | falls back to last word of `name` |
| `givenName` | `contacts.first_name` | falls back to first word of `name`; omitted if empty |
| `displayName` | `contacts.name` | |
| `mail` | `contacts.email` | omitted when empty |
| `telephoneNumber` | `contacts.phone` | business line; omitted when empty |
| `mobile` | `contacts.mobile` | omitted when empty |
| `title` | `contacts.title` | omitted when empty |
| `o` / `company` | `clients.name` | customer organisation |
| `ou` | `sites.name` | falls back to client name when no site is set |

Phone attributes additionally match digit-normalized, so a filter
`(telephoneNumber=*301234*)` finds `+49 30 123456` — this is what makes
incoming-call name display work with varying caller-ID formats.

## Agfeo TK configuration

In the Agfeo TK admin suite (LAN/Telefonanlage → Telefonbuch → LDAP):

1. **Server**: IP/hostname of the CONEX host, **port 389**.
2. **Basis-DN (base DN)**: `dc=conex,dc=local`
3. **Bind-DN**: `cn=admin,dc=conex,dc=local` (or leave empty for anonymous
   read while `LDAP_ALLOW_ANONYMOUS=true`), plus the bind password.
4. **Suchfilter (search filter)** for name dialling, e.g.:
   ```
   (|(cn=*%s*)(sn=*%s*)(telephoneNumber=*%s*))
   ```
   (`%s` = dialled substring; Agfeo substitutes the query.)
5. **Attribute mapping**:
   - Name display: `displayName` (fallback `cn`)
   - Business number: `telephoneNumber`
   - Mobile number: `mobile`
   - Company/department: `company` / `ou`
6. Incoming-call name display: configure the TK to query by calling
   number against `telephoneNumber` and `mobile`, e.g. filter
   `(|(telephoneNumber=*%s*)(mobile=*%s*))`.

## Local development

```sh
# typecheck / tests (no database needed — server tests use a mock provider)
bun run build
bun test

# run against Postgres
DATABASE_URL=postgres://conex:conex@localhost:5432/conex bun src/index.ts

# run with mock data (no database)
LDAP_MOCK_FILE=./demo-contacts.json bun src/index.ts

# HTTP debug mirror (same mapping as LDAP, no LDAP client needed)
curl 'http://localhost:3002/ldap/search?q=Mustermann'
```

## Test with ldapsearch

```sh
# anonymous address-book search
ldapsearch -x -H ldap://localhost:389 -b "dc=conex,dc=local" "(cn=*Mustermann*)"

# Agfeo-style multi-attribute search, only the phone attributes back
ldapsearch -x -H ldap://localhost:389 -b "dc=conex,dc=local" \
  "(|(cn=*Mustermann*)(sn=*Mustermann*)(telephoneNumber=*Mustermann*))" \
  cn displayName telephoneNumber mobile company ou

# incoming-call reverse lookup by number
ldapsearch -x -H ldap://localhost:389 -b "dc=conex,dc=local" "(telephoneNumber=*301234*)" displayName telephoneNumber

# authenticated bind
ldapsearch -x -H ldap://localhost:389 -b "dc=conex,dc=local" \
  -D "cn=admin,dc=conex,dc=local" -w secret "(objectClass=inetOrgPerson)" dn
```
