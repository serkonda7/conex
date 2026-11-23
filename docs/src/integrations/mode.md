# Integrationsmodus

Ein einziger Schalter legt fest, ob conex externe Systeme ansprechen darf – TANSS, Octoja,
UniFi und Microsoft Graph (für die [Outlook-Kalendersynchronisation](calendar-sync.md)):

| Modus     | Verhalten                                                                                 |
| --------- | ----------------------------------------------------------------------------------------- |
| `live`    | Standard. Die Integrationen kontaktieren ihre externen Systeme.                           |
| `offline` | Keine Anfrage verlässt den Server, z. B. für Entwicklungs-, Demo- oder Testinstanzen.      |
| `mock`    | Keine Anfrage verlässt den Server; die Anbieter liefern zuvor aufgezeichnete Schnappschüsse. |

Im Modus `offline` schlagen Synchronisierungen und andere Integrationsaktionen mit der
Meldung „integrations are offline“ fehl, bevor eine Verbindung aufgebaut wird. Bereits
gespeicherte Daten (z. B. der letzte Abgleichbericht) bleiben sichtbar. Eingehende
Schnittstellen wie das Kontaktverzeichnis für das [AGFEO-Dashboard](agfeo.md) sind nicht
betroffen.

Im Modus `mock` verhält sich der Server bei Synchronisierungen und Integrationsaktionen
wie mit erreichbaren externen Systemen: Die Anbieter geben die Daten aus einer Datei
zurück; gespeicherte Zugangsdaten werden weder geprüft noch verwendet. Das
Einrichtungsformular verlangt trotzdem Werte für die Pflichtfelder – hier genügen
Platzhalter. Auch hier werden keine Verbindungen nach außen
aufgebaut – Kalendersynchronisation und M365-Einwilligung bleiben gesperrt (Meldung
„integrations are mocked“). Schreibaktionen (Ticket, Gerät, Mitarbeiter) verändern nur
eine Kopie im Arbeitsspeicher und sind nach dem nächsten Sync sichtbar; die Datei auf der
Platte wird nie überschrieben und die Änderungen gehen beim Neustart verloren.

## Konfiguration

In `data/config.toml`:

```toml
[integrations]
mode = "offline"
# optional, Standard: "integrations-mock"
mockDir = "integrations-mock"
```

`mockDir` ist absolut oder relativ zum Datenverzeichnis (`server/data/`). Fehlt der
Abschnitt, gilt `live` – bestehende Installationen verhalten sich unverändert.

Die Umgebungsvariable `CONEX_INTEGRATIONS_MODE` (gleiche Werte) überschreibt die Datei,
etwa für einen einzelnen Testlauf:

```sh
CONEX_INTEGRATIONS_MODE=live bun run dev
```

Ein ungültiger Wert verhindert den Serverstart. Der Modus wird nur beim Start gelesen;
eine Änderung wird erst nach einem Neustart wirksam.

## Schnappschüsse aufzeichnen (`mock`)

Die Dateien werden auf einer **Live-Instanz** mit funktionierenden Integrationen
aufgezeichnet:

```sh
# alle aktivierten Integrationen
bun run integrations:snapshot
# nur ein Anbieter, anderes Ausgabeverzeichnis
bun run integrations:snapshot --provider tanss --out /tmp/conex-mock
```

Das Skript benötigt zwingend `mode = "live"`, baut jeden aktivierten Anbieter mit seinen
echten Zugangsdaten und liest Mandanten, Geräte, Tickets und Tags sequenziell pro
Mandant. Fehler werden pro Anbieter gemeldet; die übrigen Anbieter werden trotzdem
aufgezeichnet. Bei mindestens einem Fehler endet das Skript mit einem von null
verschiedenen Exit-Code.

Standardmäßig landet eine Datei `<Anbieter>.json` unter `server/data/integrations-mock/`
(oder dem konfigurierten `mockDir`). Die Schnappschüsse enthalten **Kundendaten**: Sie
liegen unter `data/`, das bereits in `.gitignore` steht, und dürfen nicht in die
Versionsverwaltung oder an Dritte weitergegeben werden.

Für eine Entwicklungs-, Demo- oder Testinstanz einfach das Verzeichnis in deren
Datenverzeichnis kopieren:

```sh
scp -r live:/srv/conex/server/data/integrations-mock \
      dev:/srv/conex/server/data/
```

Danach in `data/config.toml` der Dev-Instanz `mode = "mock"` setzen und den Server neu
starten. Fehlt die Datei eines Anbieters, meldet die entsprechende Aktion deutlich,
welcher Pfad fehlt und mit welchem Befehl er erzeugt wird.
