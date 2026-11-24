# KI-Assistent

conex kann Fragen an ein Sprachmodell weiterreichen. Der Server spricht dazu entweder
direkt mit **Claude** (Anthropic API) oder mit einer **opencode**-Instanz (`opencode serve`),
die ihre eigenen Anbieter und Zugangsdaten mitbringt.

Der Assistent ist vorbereitet, aber noch nicht an die Inventardaten angebunden: Er
beantwortet allgemeine Fragen und verweist für konkrete Objekte auf die passende Seite.
Eine Oberfläche im Client folgt.

## Berechtigung

Die Berechtigung **KI-Assistent verwenden** (`ai.use`) schaltet den Assistenten für eine
Rolle frei. Bestehende Rollen mit Benutzerverwaltung erhalten sie beim Update automatisch,
alle anderen Rollen müssen sie ausdrücklich bekommen.

## Konfiguration

Ohne Abschnitt `[ai]` ist der Assistent abgeschaltet. In `data/config.toml`:

```toml
[ai]
provider = "claude"   # claude | opencode

[ai.claude]
model = "claude-opus-5-5"   # Standard
# effort = "medium"         # low | medium | high | xhigh | max

[ai.opencode]
url = "http://127.0.0.1:4096"
# model = "anthropic/claude-opus-5-5"   # "<Anbieter>/<Modell>", sonst opencodes Standard

[ai.rateLimit]        # Anfragen je Benutzer und Zeitfenster
maxRequests = 30
windowSeconds = 300
```

Zugangsdaten gehören in die Umgebung des Servers, nicht in die Datei:

| Anbieter | Variable                   | Hinweis                                                     |
| -------- | -------------------------- | ----------------------------------------------------------- |
| Claude   | `ANTHROPIC_API_KEY`        | alternativ `apiKey` in `[ai.claude]`                        |
| opencode | `OPENCODE_SERVER_PASSWORD` | dasselbe Passwort, mit dem `opencode serve` gestartet wurde |

### Standardmodell in den globalen Einstellungen

Unter **Administration → Globale Einstellungen** (`/global-settings`) wählen Administratoren
das Standardmodell je Anbieter aus der Modellliste, die der Anbieter selbst meldet (Claude:
Models API, opencode: `GET /api/model`). Eine Auswahl dort hat Vorrang vor `model` in
`[ai.claude]` bzw. `[ai.opencode]`; ohne Auswahl gilt weiter die Datei. Ist die Liste nicht
abrufbar (Anbieter nicht erreichbar, keine Zugangsdaten), lässt sich die Modell-ID von Hand
eintragen.

Die Seite erfordert die Berechtigung **Globale Einstellungen bearbeiten**
(`settings.manage`) und ein globales Konto (ohne Mandantenbeschränkung). Bestehende Rollen
mit Benutzerverwaltung erhalten sie beim Update automatisch.

Bei Claude-Modellen, die es unterstützen, ist der serverseitige Fallback aktiv: Lehnt das
Modell eine Anfrage ab, beantwortet sie die API in derselben Anfrage mit einem
Ausweichmodell.

### opencode

conex nutzt opencodes zustandslose Textgenerierung
(`POST /api/experimental/generate/text`): ein einzelner Modellaufruf ohne Sitzung und ohne
Werkzeuge. opencode führt dabei weder Befehle aus noch liest oder schreibt es Dateien. Der
Endpunkt ist in opencode als experimentell markiert und kann sich mit neuen Versionen
ändern.

```sh
OPENCODE_SERVER_PASSWORD=… opencode serve --hostname 127.0.0.1 --port 4096
```

## Datenschutz und Integrationsmodus

Anfragen an den Assistenten verlassen den Server und können Kundendaten enthalten. Deshalb
gilt der [Integrationsmodus](mode.md) auch hier: Im Modus `offline` wird kein Anbieter
kontaktiert, im Modus `mock` antwortet ein eingebauter Platzhalter. conex speichert weder
Fragen noch Antworten.

## Schnittstelle

| Anfrage                                     | Zweck                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `GET /ai/status`                            | Ob der Assistent verfügbar ist, mit Anbieter und Modell               |
| `POST /ai/chat`                             | Nächste Antwort; der Client sendet jedes Mal den gesamten Verlauf mit |
| `GET /global-settings/ai-models?provider=…` | Modelle eines Anbieters (`claude`, `opencode`); nur `settings.manage` |

`POST /ai/chat` erwartet `{ "messages": [{ "role": "user", "text": "…" }] }`; der Verlauf
beginnt und endet mit einer Benutzernachricht. Antworten: `503`, wenn der Assistent
abgeschaltet oder offline ist, `502` bei Fehlern des Anbieters, `422`, wenn das Modell die
Anfrage ablehnt, `429` beim Überschreiten des Limits.
