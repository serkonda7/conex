# Datenmodell
## Datenbank-Rolle
Der Server führt die Migrationen beim Start mit der Rolle aus `CONEX_DATABASE_URL` aus.
Diese Rolle braucht das `CREATE`-Recht auf der Datenbank, z.B. als ihr Eigentümer:
der Migrator legt das Schema `drizzle` an, und die Suche nutzt Trigram-Indizes der
Erweiterung `pg_trgm`. `pg_trgm` ist ab Postgres 13 eine *trusted extension*,
die Rolle braucht dafür also keine Superuser-Rechte.

`pg_trgm` gehört zu den contrib-Modulen, die das offizielle `postgres`-Image und die
üblichen Distributionspakete mitbringen. Erlaubt eine verwaltete Datenbank nur
freigegebene Erweiterungen, muss `pg_trgm` dort freigegeben sein, oder ein
Administrator legt sie vor dem ersten Start an: `CREATE EXTENSION pg_trgm;`

## `tenants`
Allgemeine Kundendaten.

| Spalte            | Erforderlich | Zweck                                            |
| ----------------- | ------------ | ------------------------------------------------ |
| `id`              | ✔            | Primärschlüssel                                  |
| `tenant_group_id` |              | Teil einer Firmengruppe                          |
| `name`            | ✔            | Name                                             |
| `customer_number` |              | eindeutige Kundennummer (wie in TANSS)           |
| `website`         |              | primäre Webseite und Domäne                      |
| `emails`          | ✔            | Liste: allgemeine Mail-Adressen, z.B. `info@...` |
| `phones`          | ✔            | Liste: Hauptnummern, Zentrale, ...               |
| `comments`        |              | Hinweise zum Kunden o.ä.                                                 |
