# AGFEO Dashboard

Shows conex employees as contacts in the AGFEO Dashboard (v2): incoming calls
are resolved to a name, and the Dashboard search finds them. The optional
service `plugins/agfeo-ldap` serves the conex contact directory read-only
over LDAP, which the Dashboard reads with its built-in LDAP client. The
contacts are only available in the Dashboard, not on system phones or apps.

## Quick start with conex-docker

1. In conex, create a role with only the permission **Read contact directory
   (telephony)** and a user `agfeo` with that role.

2. Start the service
   ```sh
   echo 'COMPOSE_PROFILES=agfeo-ldap' >> .env
   docker compose up -d --build
   ```

   The image already sets `AGFEO_LDAP_CONEX_URL=http://conex:3000` and listens on `1389` inside the container, published as host port `389`.

3. Check that contacts are served:
   ```sh
   ldapsearch -x -H ldap://localhost:389 -D agfeo -W \
     -b ou=contacts,dc=conex '(objectClass=*)' cn telephoneNumber
   ```

4. In the Dashboard settings, add an account of type **LDAP**:
   | Field                 | Value                  |
   | --------------------- | ---------------------- |
   | Username (bind DN)    | `agfeo`                |
   | Password              | password of the user   |
   | Server                | CoNex host address     |
   | Port                  | `389`                  |
   | LDAP search utility   | _leave default_        |
   | Search base (base DN) | `ou=contacts,dc=conex` |
   | Additional filter     | _leave default_        |
   | Arguments             | _leave default_        |

   Then map the Dashboard fields to the [attributes](#contacts) by drag and
   drop.

## Contacts
One entry `uid=<employee ID>,<base DN>` per **active** employee.
A user limited to a tenant only sees that tenant's employees.

| Field of data source | Dashboard field   |
| -------------------- | ----------------- |
| `telephoneNumber`    | Phone (Business)  |
| `otherTelephone`     | Phone (Business)  |
| `homePhone`          | Phone (Private)   |
| `otherHomePhone`     | Phone (Private)   |
| `mobile`             | Mobile (Business) |
| `otherMobile`        | Mobile (Business) |
| `homeMobile`         | Mobile (Private)  |
| `otherHomeMobile`    | Mobile (Private)  |
| `sn`                 | Name              |
| `givenName`          | First Name        |
| `company`            | Company           |
| `department`         | Department        |

Extensions are published as business or private phone numbers, completed
with the tenant's main phone number up to its last `-` (`+49 521 44709-0` and
extension `45` give `+495214470945`); without such a main number they are left
out. Other phone numbers are not exported.


## Configuration
Environment variables of the service:

| Variable                                    | Default                | Meaning                            |
| ------------------------------------------- | ---------------------- | ---------------------------------- |
| `AGFEO_LDAP_CONEX_URL`                      | –                      | **Required.** conex API root       |
| `AGFEO_LDAP_BASE_DN`                        | `ou=contacts,dc=conex` | Search base                        |
| `AGFEO_LDAP_HOST`                           | `0.0.0.0`              | Listen address                     |
| `AGFEO_LDAP_PORT`                           | `389` (`636` with TLS) | Listen port                        |
| `AGFEO_LDAP_TLS_CERT`, `AGFEO_LDAP_TLS_KEY` | –                      | PEM files; set both to serve LDAPS |
| `AGFEO_LDAP_MAX_RESULTS`                    | `100`                  | Entries per search at most         |
| `AGFEO_LDAP_DEBUG`                          | –                      | `1` logs every search              |


## Notes
- **Security:** Binds are checked against conex; anonymous clients only see
  the root DSE. Without TLS the password is sent in plain text, so use LDAPS
  outside a trusted network.
- **Sessions:** A successful bind is reused for 15 minutes, so not every
  Dashboard lookup is a conex login (audit log, rate limit).
- **Bind user:** Plain username (`agfeo`) or DN (`uid=agfeo,dc=conex`).
- **Stale names:** The Dashboard caches resolved numbers; clear it with
  `ctimon.exe -delcache ldap`.
- **Troubleshooting:** `AGFEO_LDAP_DEBUG=1` logs each search with filter and
  attributes. Failed binds are always logged with the reason.
