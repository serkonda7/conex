# Integration Consistency Checks

The consistency report compares conex with the data of the last sync from an
external system (currently **TANSS**) and lists each difference as a *finding*.

## Sync

- **Companies:** all on the first or a forced full sync, otherwise only those
  changed since the last sync.
- **Devices:** only for companies linked to a tenant.
- Unambiguous device matches are [linked automatically](#device-matching).

### TANSS mapping

| conex         | TANSS            |
| ------------- | ---------------- |
| Tenant        | Company          |
| Device        | PC / server      |
| Asset tag     | Inventory number |

Name, serial number, manufacturer, model and active status are compared
one-to-one. A company is inactive when it is marked inactive or locked out.

## Links

Tenants and devices are linked to their external counterpart manually or by
the sync. Ignored objects are not reported as missing or suggested.

## Findings

### Linked objects

#### Tenants

| Finding                      | Meaning |
| ---------------------------- | ------- |
| **Company no longer exists** | Linked company was deleted. Its devices are not checked. |
| **Company inactive**         | Linked company is inactive. |
| **Different name**           | Tenant and company names differ. |

#### Devices

| Finding                      | Meaning |
| ---------------------------- | ------- |
| **Device no longer exists**  | Linked device was not found in the last sync. |
| **Different tenant**         | Device belongs to another company than its tenant's. |
| **Different status**         | Active in one system, inactive in the other. |
| **Different value**          | Name, serial number, asset tag, manufacturer or model differ. Empty values are not compared. |

### Not linked objects

#### Tenants

| Finding                      | Meaning |
| ---------------------------- | ------- |
| **Tenant not linked**        | Tenant has no company. Its devices are not checked. |
| **Company missing in conex** | Active, non-private company without tenant. Global report only. |

#### Devices

| Finding                      | Meaning |
| ---------------------------- | ------- |
| **Possible match**           | Devices share a serial number, asset tag or name. |
| **Missing externally**       | Active conex device without counterpart. |
| **Missing in conex**         | Active external device without counterpart. |

## Device matching

Within one tenant ↔ company, by **serial number**, then **asset tag**, then
**name**. A serial number or asset tag that is unique on both sides is linked
automatically; otherwise it is a *possible match*. Names are only suggested.
Existing links are never changed.

Comparisons ignore case and surrounding whitespace. Serial numbers also ignore
`-` `_` `.` `:` `/` and spaces; placeholders like `0000`, `N/A` or
`To be filled by O.E.M.` never match.
