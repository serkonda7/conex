# AGFEO Dashboard

The AGFEO Dashboard (v2) can use the employees of conex as an external,
read-only contact source: incoming calls are resolved to a name, and contacts
can be found by the Dashboard search. The contacts are only available in the
Dashboard, not on system phones or apps.

The optional service `plugins/agfeo-ldap` serves the conex contact directory
over LDAP, which the Dashboard reads with its built-in LDAP client. The
Dashboard logs in with a conex user; the service checks the login against
conex and reads the contacts through the conex API.

## Contacts

One entry per **active** employee:

| LDAP attribute             | Content |
| -------------------------- | ------- |
| `uid`                      | Employee ID |
| `cn`, `displayName`        | Full name |
| `givenName`, `sn`          | First / last name |
| `company`                  | Tenant name |
| `customerNumber`           | Customer number of the tenant |
| `title`                    | Title |
| `mail`                     | Primary mail address |
| `telephoneNumber`, `otherTelephone` | First / second work phone |
| `homePhone`, `otherHomePhone` | First / second private phone |
| `mobile`, `otherMobile`    | First / second mobile number (work or private) |

Other phone numbers are not exported. Entries are named
`uid=<id>,<base DN>`. A user limited to a tenant only sees that tenant's
employees.

### Phone number format

Numbers are normalized to the international format, e.g.
`+49 (0)521 44709-0` → `+49521447090`. National numbers with a leading `0`
are treated as German numbers. Searches are normalized the same way, so both
number formats of the Dashboard find a contact.

## Setup

### 1. conex user

In conex, create a role with only the permission **Read contact directory
(telephony)** and a user with that role. Limit the user to a tenant if the
Dashboard should only see that tenant's contacts.

### 2. LDAP service

Run the service next to conex (`bun run --cwd plugins/agfeo-ldap start`, or
a binary from `bun run --cwd plugins/agfeo-ldap compile`). It is configured
by environment variables:

| Variable                   | Default | Meaning |
| -------------------------- | ------- | ------- |
| `AGFEO_LDAP_CONEX_URL`     | –       | **Required.** conex API root, e.g. `http://localhost:3000` |
| `AGFEO_LDAP_BASE_DN`       | `ou=contacts,dc=conex` | Search base |
| `AGFEO_LDAP_HOST`          | `0.0.0.0` | Listen address |
| `AGFEO_LDAP_PORT`          | `389` (`636` with TLS) | Listen port |
| `AGFEO_LDAP_TLS_CERT`, `AGFEO_LDAP_TLS_KEY` | – | PEM files; set both to serve LDAPS |
| `AGFEO_LDAP_MAX_RESULTS`   | `100`   | Entries per search at most |
| `AGFEO_LDAP_DEBUG`         | –       | `1` logs every search |

Ports below 1024 need privileges, e.g. `AmbientCapabilities=CAP_NET_BIND_SERVICE`
in a systemd unit. Only the LDAP port must be reachable from the Dashboard
PCs. Without TLS the password is sent in plain text, so use LDAPS outside a
trusted network.

The service is read-only: anonymous clients may read the root DSE only,
everything else needs a bind as a conex user with the permission above.

The Dashboard opens a new connection per lookup. The service reuses the
conex session of a successful bind for 15 minutes, so not every lookup is a
conex login (audit log, login rate limit).

### 3. Dashboard account

In the Dashboard settings, add an account of type **LDAP** with the host and
port of the service, the base DN, and the conex user. The user can be given
as plain username (`agfeo`) or as DN (`uid=agfeo,dc=conex`). Then map the
Dashboard fields to the attributes above by drag and drop.

The Dashboard caches resolved numbers. After changing a number in conex,
clear its LDAP cache if needed (`ctimon.exe -delcache ldap`).

### Troubleshooting

Start the service with `AGFEO_LDAP_DEBUG=1` to log each search the
Dashboard sends, with filter and requested attributes. Failed binds are
always logged with the reason.
