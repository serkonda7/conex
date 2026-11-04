# Outlook-Kalendersynchronisation
Ein-Wege Synchronisation von TANSS-Terminen (Einsatzplanung) in die persönlichen M365 Kalender.

**Voraussetzung:**
- [TANSS-Integration](consistency.md)
- der API-Benutzer sieht die Planung aller Techniker


## Verhalten
- Zeitraum: letzte 7, nächste 60 Tage
- Termine landen im Hauptkalender (Status *Beschäftigt*, ohne Erinnerung, Kategorie
  `TANSS`).
- In TANSS gelöschte Termine werden in Outlook gelöscht. Ist TANSS nicht erreichbar,
  wird nichts gelöscht.
- Zuordnung entfernen löscht die synchronisierten Termine des Technikers; deaktivieren pausiert nur.


## 1. Entra-App registrieren
1. [Entra Admin Center](https://entra.microsoft.com) → **Anwendungen →
   App-Registrierungen → Neue Registrierung**: Name `conex calendar sync`,
   **Einzelner Mandant**, keine Umleitungs-URI.
2. **Anwendungs-ID (Client-ID)** und **Verzeichnis-ID (Mandanten-ID)** notieren.
3. **Zertifikate & Geheimnisse → Neuer geheimer Clientschlüssel**: den *Wert* sofort
   kopieren. Ablaufdatum in den Kalender eintragen, danach stoppt die Synchronisation.

Keine API-Berechtigung in Entra hinzufügen: die Kalenderrechte vergibt Schritt 2,
beschränkt auf die Techniker.


## 2. Zugriff auf Techniker-Postfächer erlauben
Der Zugriff auf die Postfächer ist geregelt durch die Sicherheitsgruppe `$Group`.
Es kann auch eine einer vorhandenen Gruppe genutzt werden.

In Exchange Online PowerShell; die Werte in den ersten beiden Zeilen anpassen:
```powershell
$ClientId = "<client-id>"              # siehe oben
$Group = "<calendar-sync@contoso.com>" # frei wählen

Connect-ExchangeOnline

# Sicherheitsgruppe mit den Technikern
New-DistributionGroup -Name "conex-calendar-sync" -Type Security `
  -PrimarySmtpAddress $Group -Members techniker1@contoso.com, techniker2@contoso.com

# Objekt-ID: Entra → Unternehmensanwendungen → conex calendar sync → Objekt-ID
New-ServicePrincipal -AppId $ClientId -ObjectId "<objekt-id>" -DisplayName "conex calendar sync"

$Dn = (Get-DistributionGroup $Group).DistinguishedName
New-ManagementScope -Name "conex calendar sync" `
  -RecipientRestrictionFilter "MemberOfGroup -eq '$Dn'"
New-ManagementRoleAssignment -App $ClientId -Role "Application Calendars.ReadWrite" `
  -CustomResourceScope "conex calendar sync"
```

Prüfen (bis zu 2 Stunden Verzögerung):
```powershell
Test-ServicePrincipalAuthorization -Identity $ClientId -Resource techniker1@contoso.com
```

Weitere Techniker später hinzufügen:
```powershell
Add-DistributionGroupMember -Identity $Group -Member <upn>
```


## 3. conex einrichten
**Integrationen → Outlook-Kalendersynchronisation** (Berechtigung
`integrations.manage`):

1. **Mandanten-ID**, **Anwendungs-ID (Client-ID)** und **Geheimer Clientschlüssel**
   eintragen.
2. **Testpostfach** eines Technikers eintragen → **Verbindung testen** muss
   erfolgreich sein. Ein Postfach außerhalb der Gruppe muss fehlschlagen.
3. **Intervall (Minuten)** setzen, **Aktiviert** anhaken, **Speichern**.
4. In der Tabelle **Techniker** das Postfach prüfen und **Zuordnen** klicken.
5. **Jetzt synchronisieren**; Ergebnis und Fehler stehen unter **Letzte Läufe**.


## Fehlerbehebung
| Fehler                                 | Ursache                                                     |
| -------------------------------------- | ----------------------------------------------------------- |
| `AADSTS7000215: Invalid client secret` | Geheimnis falsch kopiert oder abgelaufen: neues anlegen.    |
| `ErrorAccessDenied` / 403              | Postfach nicht in der Gruppe, oder Rechte noch nicht aktiv. |
| `MailboxNotEnabledForRESTAPI` / 404    | UPN falsch oder kein Exchange-Online-Postfach.              |
