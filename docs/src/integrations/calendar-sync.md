# Outlook Calendar Sync

Copies fixed TANSS appointments (Einsatzplanung, planning type
`APPOINTMENT_FIX`) of mapped technicians into their Microsoft 365 / Exchange
Online calendars. Changes and deletions in TANSS follow within the configured
interval. The sync runs in one direction only: TANSS is the master, and
changes made to synced events in Outlook are overwritten on the next change
in TANSS.

The sync builds on the [TANSS integration](consistency.md): it uses the
stored TANSS user-API login, which must be able to see the planning of all
technicians. Set up the TANSS integration first.

## What is synced

- **Window:** from 7 days ago to 60 days ahead, checked every run.
- **Events** go into each technician's main calendar, so they count towards
  free/busy:

  | Outlook field | Source                                                                    |
  | ------------- | ------------------------------------------------------------------------- |
  | Subject       | Outlook title of the appointment, else `[#ticket] ticket title (company)` |
  | Start / end   | Appointment start and duration                                            |
  | Location      | Outlook location, else Office / Remote, or the company for on-site work   |
  | Body          | Link to the TANSS ticket and the appointment text                         |
  | Show as       | Busy                                                                      |
  | Reminder      | Off                                                                       |

  Every event carries the category `TANSS` and a hidden extended property
  `conexTanssId`.
- **Deletions:** an event is deleted when its appointment is gone from TANSS
  and it lies inside the window. Events that age out of the window stay. If
  TANSS cannot be reached, nothing is deleted.
- **Events deleted in Outlook** are created again the next time the
  appointment changes in TANSS.
- **Mappings:** removing a technician's mapping deletes their synced events
  on the next run; disabling it pauses the sync and leaves the events alone.

## 1. Register an Entra app

1. In the [Microsoft Entra admin center](https://entra.microsoft.com), open
   **Applications → App registrations → New registration**. Name it e.g.
   `conex calendar sync`, keep **Single tenant**, no redirect URI.
2. Note the **Application (client) ID** and the **Directory (tenant) ID**
   on the overview page.
3. **Certificates & secrets → Client secrets → New client secret.** Copy the
   secret *value* (not its id) right away. Put a reminder in your calendar
   for its expiry date: the sync stops when the secret expires.
4. **API permissions → Add a permission → Microsoft Graph → Application
   permissions → `Calendars.ReadWrite`**, then **Grant admin consent for
   &lt;tenant&gt;**. No delegated permissions are needed.

## 2. Limit the app to technician mailboxes

Without a limit, `Calendars.ReadWrite` lets the app write to **every mailbox
in the tenant**. Restrict it to the technicians with one of the following
(Exchange Online PowerShell, `Connect-ExchangeOnline`).

Create a mail-enabled security group with the technicians first, e.g.
`conex-calendar-sync@contoso.com`.

### RBAC for Applications (recommended)

```powershell
# Service principal of the app (ids from step 1; ObjectId of the Enterprise app)
New-ServicePrincipal -AppId <client-id> -ObjectId <enterprise-app-object-id> `
  -DisplayName "conex calendar sync"

# Management scope: only members of the group
New-ManagementScope -Name "conex calendar sync" `
  -RecipientRestrictionFilter "MemberOfGroup -eq '<distinguished name of the group>'"

New-ManagementRoleAssignment -App <client-id> -Role "Application Calendars.ReadWrite" `
  -CustomResourceScope "conex calendar sync"
```

With RBAC for Applications, **remove** the tenant-wide `Calendars.ReadWrite`
grant from the app registration again (step 1.4); otherwise the Entra grant
still allows every mailbox.

### Application Access Policy (legacy)

Keep the Entra permission from step 1 and add:

```powershell
New-ApplicationAccessPolicy -AppId <client-id> -AccessRight RestrictAccess `
  -PolicyScopeGroupId conex-calendar-sync@contoso.com `
  -Description "conex calendar sync: technicians only"
```

### Check the scope

```powershell
Test-ServicePrincipalAuthorization -Identity <client-id> -Resource technician@contoso.com  # RBAC
Test-ApplicationAccessPolicy -AppId <client-id> -Identity technician@contoso.com         # policy
```

Changes can take up to an hour (policy) or two hours (RBAC) to apply.

## 3. Configure conex

On **Integrations → Outlook calendar sync** (shown once TANSS is set up;
global `integrations.manage` permission):

1. Enter the tenant ID (or primary domain), the client ID and the secret.
   **Test connection** requests a token; with a test mailbox it also reads
   that mailbox's calendar, which checks the scoping from step 2 (try a
   technician and a mailbox outside the group: the latter must fail).
2. Set the interval (minutes), tick **Enabled** and save.
3. In the technicians table, check the mailbox (prefilled from the TANSS
   email) and **Map** each technician to sync.
4. **Sync now** starts a run right away; the table below lists the last runs
   with their counts and errors. A failing mailbox is reported in the run's
   error and does not stop the others.

All settings and mapping changes, and manual runs, are written to the audit
log.

## Troubleshooting

- **`AADSTS7000215: Invalid client secret`:** the secret value was copied
  wrong, or the secret expired. Create a new one and save it.
- **`ErrorAccessDenied` / 403 for a mailbox:** the mailbox is outside the
  RBAC scope or access policy, or admin consent is missing.
- **`MailboxNotEnabledForRESTAPI` / 404 for a mailbox:** the UPN is wrong,
  or the user has no Exchange Online mailbox.
- **Field names or recurring appointments look wrong:** the first
  appointment list after each server start is saved unmodified to the TANSS
  dump directory (`CONEX_TANSS_DUMP_DIR`, default `data/inegrations`) as
  `…-supports-list-…json`.
