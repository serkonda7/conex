import { POE_MODES, POE_TYPES, SELECTABLE_PASS_THROUGH_PORT_TYPES } from 'shared/src/schemas'

export interface PromptRole {
	name: string
	description: string | null
}

/** Role names the AI may pick for `default_device_role`, one per line. */
function roleList(roles: readonly PromptRole[]): string {
	if (roles.length === 0) {
		return 'No device roles exist yet, so never emit default_device_role.'
	}
	const lines = roles.map((r) =>
		r.description ? `- ${r.name}: ${r.description}` : `- ${r.name}`,
	)
	return `Available device roles (name: description):\n${lines.join('\n')}`
}

/** Format and field rules shared by the prompts. */
function outputRules(roles: readonly PromptRole[]): string {
	return `Output one YAML document starting with --- in a fenced YAML block, plus the target path device-types/<Manufacturer>/<model-slug>.yaml outside the block. Keep the source summary outside the YAML so the block can be pasted directly into conex.

Write all free-text output in German: model, manufacturer, description, comments and the summary outside the YAML block.
Keep brand names and official product designations unchanged, but use German for generic terms (e.g. "Patchfeld 24-Port Cat6", "Steckdosenleiste 8-fach", "Fachboden"). For vendor-neutral devices use manufacturer "Generisch", even when the upstream file sits under Generic/.

Emit only: manufacturer, model, u_height, is_full_depth, default_device_role, part_number, spec_url, eol_date, description, comments, interfaces, ports, power-ports, power-outlets, display-ports, rear-ports, front-ports, port-mappings. console-ports is an import alias of ports; prefer ports and never duplicate entries in both. Drop all other NetBox keys when adapting a baseline.

Rules:
- manufacturer must equal the directory name of the target path (device-types/Generisch/ for vendor-neutral devices). manufacturer and model: 1-100 characters.
- u_height: integer 0-60 (0 for laptop/desktop/dock/phone).
- is_full_depth: default false, true for rack-mounted devices that occupy the full depth of the rack.
- Port names must be unique across all lists (front-ports and rear-ports may reuse each other's names), 1-50 characters, matching ^[A-Za-z0-9ÄÖÜäöüß_.? -]+$ (letters incl. German umlauts and ß, digits, spaces, dot, dash, underscore, question mark; no slashes). Normalize source port names when adapting a baseline. No empty strings anywhere.
- Port name prefixes: never prefix names with a generic "Port" ("Port-01", "Port 01", "Port01"); a plain numbered port is its bare number ("01" to "24"). Keep only prefixes that carry meaning, as printed on the device or in the datasheet (e.g. "LAN 1", "SFP 1", "eth01", "Management"), and also drop a generic "Port" prefix from the baseline.
- Port numbering: names must sort correctly as plain text, so pad every number in a numbered series with leading zeros to the digit count of its highest number: 24 ports are "01" to "24", 48 interfaces "eth01" to "eth48", never "1, 10, 11, ..., 2". Series of at most 9 stay unpadded ("LAN 1" to "LAN 4"). Apply this to every port list, interfaces in particular, also when the baseline or datasheet numbers without padding. Keep one consistent scheme per series (same prefix, separator and width), also when its ports differ in type or PoE (16 PoE+ and 8 PoE++ ports are "01" to "16" and "17" to "24"), list ports in their numbering order, and name a rear port after the front ports it serves (e.g. "Rear 01").
- interfaces type: NetBox slug, e.g. 1000base-t, 10gbase-t, 1000base-x-sfp, 10gbase-x-sfpp, 25gbase-x-sfp28, 40gbase-x-qsfpp, 100gbase-x-qsfp28, ieee802.11ac, ieee802.11ax, ieee802.11be, lte, 5g, other.
- interfaces PoE (only on wired interfaces, only if stated in the datasheet or baseline): poe_mode ${POE_MODES.join(' or ')} (pse supplies power, pd draws it); poe_type ${POE_TYPES.join(', ')}. poe_type needs poe_mode. For passive PoE, keep poe_mode and omit poe_type.
- ports type: rj-45, de-9, db-25, rj-11, rj-12, mini-din-8, usb-a, usb-b, usb-c, usb-mini-a, usb-mini-b, usb-micro-a, usb-micro-b, usb-micro-ab, port or other.
- display-ports type is required: hdmi, displayport, vga or dvi (conex extension).
- Patch panels and fiber cassettes: rear-ports {name, type, positions} (positions 1 for a plain outlet, N for an MPO trunk), front-ports {name, type, positions: 1} and one port-mappings entry {front_port, front_port_position: 1, rear_port, rear_port_position} per front port; front_port and rear_port name ports of the same document. Common types: ${SELECTABLE_PASS_THROUGH_PORT_TYPES.join(', ')}. Legacy types 110-punch, st, fc and mtrj are also supported when needed to represent the actual hardware. Each slot of a rear port takes at most one front port.
- power-ports type: NetBox slug, e.g. iec-60320-c14, iec-60320-c20, ita-ef, dc-terminal or usb-c, or dc-barrel (conex extension); add maximum_draw (watts, whole number of at least 1) only if stated in the datasheet. power-outlets type: NetBox slug, e.g. iec-60320-c13, iec-60320-c19, ita-f, dc-terminal or usb-a. Other connector types import as a generic power port or outlet.
- default_device_role (conex extension): the role preselected for devices of this type. Use the exact name of one role from the list below that clearly fits the device class (e.g. switch, firewall, patch panel, server); omit the key if none fits or the choice is ambiguous. Never invent a role name, and drop a role from an upstream file that is not in the list.
- part_number (conex extension): the manufacturer's article/part number of this exact model, at most 100 characters; omit if not found in a primary source. spec_url (conex extension): plain URL (https://...) of the manufacturer's specification/datasheet page, at most 200 characters; omit if none is known. Never invent either.
- eol_date (conex extension): last day the manufacturer supports this exact model (end of life / end of support), as an ISO date YYYY-MM-DD. Only set it from an official manufacturer EOL/EOS notice, lifecycle page or support policy that names this model and states a full date, or a month and year (then use the first day of that month, e.g. March 2027 becomes 2027-03-01, and say so in the summary); cite that source in the summary. Omit it otherwise: never take it from memory, resellers, forums or third-party trackers, never estimate or calculate it (e.g. from the release date, a support duration or a lifecycle policy), never carry it over from a sibling model or series, never use an end-of-sale, end-of-production or announcement date, and never turn a quarter, half-year or bare year into a day. A missing eol_date is correct; a made-up one is not.
- description: one line, at most 250 characters. comments: omit by default; use it only for short, useful notes that fit nowhere else, and never repeat spec_url or a source link there. Ports have no description: never emit one, and drop port descriptions from a baseline. Put information a port name must carry into the name itself (e.g. "Management", "Uplink").

${roleList(roles)}`
}

const CLOSING =
	'End outside the YAML block with: sources, upstream hit/miss for both libraries, uncertain fields and file path.'

export function buildAiPrompt(
	manufacturer: string,
	model: string,
	roles: readonly PromptRole[],
): string {
	return `Generate a conex device-type YAML for manufacturer "${manufacturer}", model "${model}".

Source priority:
1) https://github.com/serkonda7/conex-device-types — look for an exact match in device-types/<Manufacturer>/<model>.yaml and return it as-is if found (apart from the German naming and comments rules below).
2) https://github.com/netbox-community/devicetype-library — copy the baseline if found, keeping only the supported keys below.
3) Manufacturer specifications, PSREF or manuals — fill gaps only from primary sources. Never guess; omit uncertain optional fields or use type: other (interfaces) / port (general ports). Never invent a display-port type.

Generic manufacturer: if the manufacturer is "Generic" or a variant of it (e.g. "generisch", "-"), the device is vendor-neutral. Both libraries keep such devices under Generic/ with English model names, so translate the model to its common English term for searching only (e.g. "Patchfeld 24 Port Cat6" -> "Patch Panel 24-Port Cat6", "Steckdosenleiste 8-fach" -> "Power Strip 8-Outlet", "Fachboden" -> "Shelf") and also try close English synonyms. Instead of vendor datasheets, base the ports on the common standard configuration of that device class and list any assumptions under uncertain fields.

${outputRules(roles)}

${CLOSING}`
}

/**
 * Prompt to refresh an existing type, e.g. after prompt or field changes.
 * Upstream files may predate those changes, so unlike `buildAiPrompt` nothing
 * is returned as-is, and the identity stays fixed so the update can't drift.
 */
export function buildAiUpdatePrompt(currentYaml: string, roles: readonly PromptRole[]): string {
	return `Update this existing conex device-type YAML to the rules below. It is the current state of the device type in conex.

\`\`\`yaml
${currentYaml.trim()}
\`\`\`

How to update:
- Keep manufacturer and model exactly as they are, even if the naming rules below would change them.
- Treat the current YAML as the baseline. Keep every value that is still correct, including hand-edited port names, and do not reword or reorder anything without a reason. Do rename generic numbered series that break the port name prefix or numbering rules below (e.g. "Port 1" or "Port-01" becomes "01" in a series of 24).
- Check every field against these sources and add what the rules below support but the YAML lacks: 1) https://github.com/serkonda7/conex-device-types (device-types/<Manufacturer>/<model>.yaml), 2) https://github.com/netbox-community/devicetype-library, 3) manufacturer specifications, PSREF or manuals. These files may predate the rules below, so never return one as-is; manufacturer sources win over the libraries, and the libraries never overwrite a correct value.
- Return the complete definition with every port, not only the changes: a port left out of a list is removed. A key left out keeps its current value, so omit fields you cannot verify instead of guessing, and set a key to null only to clear a value that is wrong.
- Keep the port-mappings format for front ports. Never guess.

${outputRules(roles)}

${CLOSING} Also list what you changed and why.`
}
