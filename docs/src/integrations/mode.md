# Integrationsmodus

Ein einziger Schalter legt fest, ob conex externe Systeme ansprechen darf – TANSS, Octoja,
UniFi und Microsoft Graph (für die [Outlook-Kalendersynchronisation](calendar-sync.md)):

| Modus     | Verhalten                                                              |
| --------- | ---------------------------------------------------------------------- |
| `live`    | Standard. Die Integrationen kontaktieren ihre externen Systeme.        |
| `offline` | Keine Anfrage verlässt den Server, z. B. für Entwicklungs-, Demo- oder Testinstanzen. |

Im Modus `offline` schlagen Synchronisierungen und andere Integrationsaktionen mit der
Meldung „integrations are offline“ fehl, bevor eine Verbindung aufgebaut wird. Bereits
gespeicherte Daten (z. B. der letzte Abgleichbericht) bleiben sichtbar. Eingehende
Schnittstellen wie das Kontaktverzeichnis für das [AGFEO-Dashboard](agfeo.md) sind nicht
betroffen.

## Konfiguration

In `data/config.toml`:

```toml
[integrations]
mode = "offline"
```

Fehlt der Abschnitt, gilt `live` – bestehende Installationen verhalten sich unverändert.

Die Umgebungsvariable `CONEX_INTEGRATIONS_MODE` (gleiche Werte) überschreibt die Datei,
etwa für einen einzelnen Testlauf:

```sh
CONEX_INTEGRATIONS_MODE=live bun run dev
```

Ein ungültiger Wert verhindert den Serverstart. Der Modus wird nur beim Start gelesen;
eine Änderung wird erst nach einem Neustart wirksam.
