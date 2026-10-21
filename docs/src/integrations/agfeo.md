# AGFEO-Dashboard

Zeigt die conex-Mitarbeiter im AGFEO-Dashboard (v2) als Kontakte an: eingehende Anrufe
werden zu einem Namen aufgelöst, und die Dashboard-Suche findet sie. Der optionale Dienst
`plugins/agfeo-ldap` stellt das conex-Kontaktverzeichnis schreibgeschützt über LDAP
bereit, das das Dashboard mit seinem integrierten LDAP-Client liest. Die Kontakte sind
nur im Dashboard verfügbar, nicht auf Systemtelefonen oder in Apps.

## Schnellstart mit conex-docker

1. In conex eine Rolle anlegen, die nur die Berechtigung **Kontaktverzeichnis lesen
   (Telefonie)** hat, sowie einen Benutzer `agfeo` mit dieser Rolle.

2. Dienst starten
   ```sh
   echo 'COMPOSE_PROFILES=agfeo-ldap' >> .env
   docker compose up -d --build
   ```

   Das Image setzt bereits `AGFEO_LDAP_CONEX_URL=http://conex:3000` und lauscht im
   Container auf `1389`, veröffentlicht als Host-Port `389`.

3. Prüfen, ob Kontakte ausgeliefert werden
   ```sh
   ldapsearch -x -H ldap://localhost:389 -D agfeo -W \
     -b ou=contacts,dc=conex '(objectClass=*)' cn telephoneNumber
   ```

4. In den Dashboard-Einstellungen ein Konto vom Typ **LDAP** hinzufügen:
| Feld                    | Wert                   |
| ----------------------- | ---------------------- |
| Benutzername (Bind-DN)  | `agfeo`                |
| Passwort                | Passwort des Benutzers |
| Server                  | Host-Adresse von conex |
| Port                    | `389`                  |
| LDAP-Suchdienstprogramm | _Standard belassen_    |
| Suchbasis (Base-DN)     | `ou=contacts,dc=conex` |
| Zusätzlicher Filter     | _Standard belassen_    |
| Argumente               | _Standard belassen_    |

   Danach die Dashboard-Felder per Drag-and-drop den [Attributen](#kontakte) zuordnen.

## Kontakte
Ein Eintrag `uid=<Mitarbeiter-ID>,<Base-DN>` pro **aktivem** Mitarbeiter.
Ein Benutzer, der auf einen Mandanten eingeschränkt ist, sieht nur die Mitarbeiter
dieses Mandanten.

| Feld der Datenquelle | Dashboard-Feld         |
| -------------------- | ---------------------- |
| `telephoneNumber`    | Telefon (Geschäftlich) |
| `otherTelephone`     | Telefon (Geschäftlich) |
| `homePhone`          | Telefon (Privat)       |
| `otherHomePhone`     | Telefon (Privat)       |
| `mobile`             | Mobil (Geschäftlich)   |
| `otherMobile`        | Mobil (Geschäftlich)   |
| `homeMobile`         | Mobil (Privat)         |
| `otherHomeMobile`    | Mobil (Privat)         |
| `sn`                 | Nachname               |
| `givenName`          | Vorname                |
| `company`            | Firma                  |
| `department`         | Abteilung              |

Durchwahlen werden als geschäftliche oder private Telefonnummern veröffentlicht,
ergänzt um die Hauptnummer des Mandanten bis zum letzten `-` (`+49 521 44709-0` und
Durchwahl `45` ergeben `+495214470945`); ohne eine solche Hauptnummer bleiben sie weg.
Andere Telefonnummern werden nicht exportiert.


## Konfiguration
Umgebungsvariablen des Dienstes:

| Variable                                    | Standard               | Bedeutung                                      |
| ------------------------------------------- | ---------------------- | ---------------------------------------------- |
| `AGFEO_LDAP_CONEX_URL`                      | –                      | **Erforderlich.** conex-API-Wurzel             |
| `AGFEO_LDAP_BASE_DN`                        | `ou=contacts,dc=conex` | Suchbasis                                      |
| `AGFEO_LDAP_HOST`                           | `0.0.0.0`              | Listen-Adresse                                 |
| `AGFEO_LDAP_PORT`                           | `389` (`636` mit TLS)  | Listen-Port                                    |
| `AGFEO_LDAP_TLS_CERT`, `AGFEO_LDAP_TLS_KEY` | –                      | PEM-Dateien; beide setzen, um LDAPS anzubieten |
| `AGFEO_LDAP_MAX_RESULTS`                    | `100`                  | Höchste Anzahl Einträge pro Suche              |
| `AGFEO_LDAP_DEBUG`                          | –                      | `1` protokolliert jede Suche                   |


## Hinweise
- **Sicherheit:** Bindings werden gegen conex geprüft; anonyme Clients sehen nur die
  Root-DSE. Ohne TLS wird das Passwort im Klartext gesendet, daher außerhalb eines
  vertrauenswürdigen Netzwerks LDAPS verwenden.
- **Sitzungen:** Eine erfolgreiche Bindung wird 15 Minuten wiederverwendet, damit nicht
  jede Dashboard-Suche ein conex-Login ist (Audit-Log, Rate-Limit).
- **Bind-Benutzer:** Reiner Benutzername (`agfeo`) oder DN (`uid=agfeo,dc=conex`).
- **Veraltete Namen:** Das Dashboard merkt sich aufgelöste Nummern; mit
  `ctimon.exe -delcache ldap` leeren.
- **Fehlersuche:** `AGFEO_LDAP_DEBUG=1` protokolliert jede Suche mit Filter und
  Attributen. Fehlgeschlagene Bindings werden immer mit dem Grund protokolliert.
