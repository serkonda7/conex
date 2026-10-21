# Datenmodell
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
