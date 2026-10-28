# Datenabgleich der Integrationen

Der Abgleichbericht vergleicht conex mit den Daten der letzten Synchronisierung aus einem
externen System (derzeit **TANSS**) und listet jede Abweichung als *Befund*. Er umfasst
die Mandanten des ausgewählten Mandantenkontexts und lädt sich neu, wenn der Kontext
gewechselt wird.

## Synchronisierung

- **Firmen:** bei der ersten oder einer erzwungenen vollständigen Synchronisierung alle,
  sonst nur die seit der letzten Synchronisierung geänderten.
- **Geräte:** nur für Firmen, die mit einem Mandanten verknüpft sind.
- **Tags:** alle, bei jeder Synchronisierung.
- Eindeutige Gerätezuordnungen werden [automatisch verknüpft](#gerätezuordnung).

### TANSS-Zuordnung

| conex          | TANSS                     |
| -------------- | ------------------------- |
| Mandant        | Firma                     |
| Gerät          | PC / Server / Peripherie  |
| Inventarnummer | Inventarnummer            |
| Priorität      | Tag (gleiche Bezeichnung) |

Name, Seriennummer, Hersteller, Modell und Aktivstatus werden einzeln miteinander
verglichen.

Ein neues Ticket erhält den Tag, der zu seiner Priorität gehört: die Bezeichnung
`P<rank> - <name>`, z. B. `P1 - Critical` (Groß-/Kleinschreibung wird ignoriert).
Existiert dieser Tag nicht in TANSS, wird kein Ticket angelegt.

## Verknüpfungen

Mandanten und Geräte werden manuell oder durch die Synchronisierung mit ihrem externen
Gegenstück verknüpft. Ignorierte Objekte werden weder als fehlend noch als Vorschlag
gemeldet.

## Befunde

### Verknüpfte Objekte

#### Mandanten

| Befund                         | Bedeutung                                                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Firma existiert nicht mehr** | Die verknüpfte Firma wurde gelöscht. Ihre Geräte werden nicht geprüft.                                                                                                                                                                |
| **Firma inaktiv**              | Die verknüpfte Firma ist inaktiv.                                                                                                                                                                                                     |
| **Abweichende Kundennummer**   | Die Kundennummern von Mandant und Firma unterscheiden sich. Eine fehlende Nummer auf einer Seite zählt ebenfalls als Abweichung (nur wenn beide leer sind, sind sie gleich); beim Vergleich wird die Groß-/Kleinschreibung ignoriert. |

#### Geräte

| Befund                         | Bedeutung                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gerät existiert nicht mehr** | Das verknüpfte Gerät wurde bei der letzten Synchronisierung nicht gefunden.                                                                                                                                                                                                                                                                                                                             |
| **Abweichung**                 | Ein Befund je abweichendem Merkmal: Mandant (das Gerät gehört zu einer anderen Firma als sein Mandant), Status (in einem System aktiv, im anderen inaktiv) oder Name, Seriennummer, Inventarnummer, Hersteller oder Modell (leere Werte werden nicht verglichen). Name, Hersteller und Modell können in TANSS mit dem conex-Wert überschrieben werden; der Hersteller muss in TANSS bereits existieren. |

#### Mitarbeiter

Ist ein verknüpfter Mitarbeiter in conex inaktiv, aber in TANSS aktiv, kann er im
Bericht auch in TANSS inaktiv gesetzt werden. Dies betrifft alle Firmen, denen er in
TANSS zugeordnet ist.

### Nicht verknüpfte Objekte

#### Mandanten

| Befund                      | Bedeutung                                                            |
| --------------------------- | -------------------------------------------------------------------- |
| **Mandant nicht verknüpft** | Der Mandant hat keine Firma. Seine Geräte werden nicht geprüft.      |
| **Firma fehlt in conex**    | Aktive, nicht-private Firma ohne Mandanten. Nur im globalen Bericht. |

#### Geräte

| Befund                 | Bedeutung                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| **Mögliche Zuordnung** | Die Geräte teilen sich Seriennummer, Inventarnummer oder Namen.                                        |
| **Fehlt extern**       | Aktives conex-Gerät ohne Gegenstück. Kann im externen System angelegt werden, das es sofort verknüpft. |
| **Fehlt in conex**     | Aktives externes Gerät ohne Gegenstück.                                                                |

#### Mitarbeiter

Aktive TANSS-Mitarbeiter ohne Gegenstück können in conex übernommen oder direkt in
TANSS inaktiv gesetzt werden. Auch bei einer möglichen Zuordnung ist das Inaktivsetzen
möglich. Es betrifft alle zugeordneten Firmen; der Zuordnungsvorschlag bleibt erhalten.

### Prioritäten

| Befund                   | Bedeutung                                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prioritäts-Tag fehlt** | Kein TANSS-Tag trägt die Bezeichnung der Priorität (`P<rank> - <name>`). Tickets mit dieser Priorität können nicht angelegt werden. Nur im globalen Bericht, nach einer Synchronisierung. |

## Gerätezuordnung

Innerhalb einer Zuordnung Mandant ↔ Firma zuerst nach **Seriennummer**, dann nach
**Inventarnummer**, dann nach **Namen**. Eine Seriennummer oder Inventarnummer, die auf
beiden Seiten eindeutig ist, wird automatisch verknüpft; andernfalls handelt es sich um
eine *mögliche Zuordnung*. Namen werden nur vorgeschlagen. Bestehende Verknüpfungen
werden nie geändert.

Bei Vergleichen werden Groß-/Kleinschreibung und umgebende Leerzeichen ignoriert. Bei
Seriennummern werden zusätzlich `-` `_` `.` `:` `/` und Leerzeichen ignoriert;
Platzhalter wie `0000`, `N/A` oder `To be filled by O.E.M.` stimmen nie überein.
