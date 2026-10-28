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

Output one YAML document starting with --- in a fenced YAML block, plus the target path device-types/<Manufacturer>/<model-slug>.yaml outside the block. Keep the source summary outside the YAML so the block can be pasted directly into conex.

Write all free-text output in German: model, manufacturer, description, comments, port descriptions and the summary outside the YAML block.
Keep brand names and official product designations unchanged, but use German for generic terms (e.g. "Patchfeld 24-Port Cat6", "Steckdosenleiste 8-fach", "Fachboden"). For vendor-neutral devices use manufacturer "Generisch", even when the upstream file sits under Generic/.

Emit only: manufacturer, model, slug, u_height, is_full_depth, default_device_role, part_number, spec_url, description, comments, interfaces, ports, power-ports, power-outlets, display-ports, rear-ports, front-ports, port-mappings. console-ports is an import alias of ports; prefer ports and never duplicate entries in both. Drop all other NetBox keys when adapting a baseline.

Rules:
- manufacturer must equal the directory name of the target path (device-types/Generisch/ for vendor-neutral devices). manufacturer and model: 1-100 characters. slug: 1-100 characters, ^[-a-z0-9_]+$, form <mfr-slug>-<model-slug>.
- u_height: integer 0-60 (0 for laptop/desktop/dock/phone).
- is_full_depth: default false, true for rack-mounted devices that occupy the full depth of the rack.
- Port names must be unique across all lists (front-ports and rear-ports may reuse each other's names), 1-50 characters, ASCII only, matching ^[A-Za-z0-9_.-]+$ (no spaces or slashes). Normalize source port names when adapting a baseline. No empty strings anywhere.
- interfaces type: NetBox slug, e.g. 1000base-t, 10gbase-t, 1000base-x-sfp, 10gbase-x-sfpp, 25gbase-x-sfp28, 40gbase-x-qsfpp, 100gbase-x-qsfp28, ieee802.11ac, ieee802.11ax, ieee802.11be, lte, 5g, other.
- ports type: rj-45, de-9, db-25, rj-11, rj-12, mini-din-8, usb-a, usb-b, usb-c, usb-mini-a, usb-mini-b, usb-micro-a, usb-micro-b, usb-micro-ab, port or other.
- display-ports type is required: hdmi, displayport, vga or dvi (conex extension).
- Patch panels and fiber cassettes: rear-ports {name, type, positions} (positions 1 for a plain outlet, N for an MPO trunk), front-ports {name, type, positions: 1} and one port-mappings entry {front_port, front_port_position: 1, rear_port, rear_port_position} per front port; front_port and rear_port name ports of the same document. type: 8p8c, 110-punch, lc, lc-apc, sc, sc-apc, st, fc, mpo, mtrj or splice. Each slot of a rear port takes at most one front port.
- power-ports type: e.g. dc-terminal or iec-60320-c14; add maximum_draw only if stated in the datasheet. power-outlets use the documented NetBox connector type.
- default_device_role (conex extension): the role preselected for devices of this type. Use the exact name of one role from the list below that clearly fits the device class (e.g. switch, firewall, patch panel, server); omit the key if none fits or the choice is ambiguous. Never invent a role name, and drop a role from an upstream file that is not in the list.
- part_number (conex extension): the manufacturer's article/part number of this exact model, at most 100 characters; omit if not found in a primary source. spec_url (conex extension): plain URL (https://...) of the manufacturer's specification/datasheet page, at most 200 characters; omit if none is known. Never invent either.
- description: one line, at most 200 characters. comments: omit by default; use it only for short, useful notes that fit nowhere else, and never repeat spec_url or a source link there. Port descriptions: at most 200 characters.

${roleList(roles)}

End outside the YAML block with: sources, upstream hit/miss for both libraries, uncertain fields and file path.`
}
