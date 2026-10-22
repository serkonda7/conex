export function buildAiPrompt(manufacturer: string, model: string): string {
	return `Generate a conex device-type YAML for manufacturer "${manufacturer}", model "${model}".

Source priority:
1) https://github.com/serkonda7/conex-device-types — look for an exact match in device-types/<Manufacturer>/<model>.yaml and return it as-is if found.
2) https://github.com/netbox-community/devicetype-library — copy the baseline if found, keeping only the supported keys below.
3) Manufacturer specifications, PSREF or manuals — fill gaps only from primary sources and record URLs in comments. Never guess; omit uncertain optional fields or use type: other (interfaces) / port (general ports). Never invent a display-port type.

Output one YAML document starting with --- in a fenced YAML block, plus the target path device-types/<Manufacturer>/<model-slug>.yaml outside the block. Keep the source summary outside the YAML so the block can be pasted directly into conex.

Write all free-text output in German: description, comments, port descriptions and the summary outside the YAML block.

Emit only: manufacturer, model, slug, u_height, is_full_depth, description, comments, interfaces, ports, power-ports, power-outlets, display-ports, rear-ports, front-ports, port-mappings. console-ports is an import alias of ports; prefer ports and never duplicate entries in both. Drop all other NetBox keys when adapting a baseline.

Rules:
- manufacturer must equal the directory name. manufacturer and model: 1-100 characters. slug: 1-100 characters, ^[-a-z0-9_]+$, form <mfr-slug>-<model-slug>.
- u_height: integer 0-60 (0 for laptop/desktop/dock/phone).
- is_full_depth: default false, true for rack-mounted devices that occupy the full depth of the rack.
- Port names must be unique across all lists (front-ports and rear-ports may reuse each other's names), 1-50 characters, ASCII only, matching ^[A-Za-z0-9_.-]+$ (no spaces or slashes). Normalize source port names when adapting a baseline. No empty strings anywhere.
- interfaces type: NetBox slug, e.g. 1000base-t, 10gbase-t, 1000base-x-sfp, 10gbase-x-sfpp, 25gbase-x-sfp28, 40gbase-x-qsfpp, 100gbase-x-qsfp28, ieee802.11ac, ieee802.11ax, ieee802.11be, lte, 5g, other.
- ports type: rj-45, de-9, db-25, rj-11, rj-12, mini-din-8, usb-a, usb-b, usb-c, usb-mini-a, usb-mini-b, usb-micro-a, usb-micro-b, usb-micro-ab, port or other.
- display-ports type is required: hdmi, displayport, vga or dvi (conex extension).
- Patch panels and fiber cassettes: rear-ports {name, type, positions} (positions 1 for a plain outlet, N for an MPO trunk), front-ports {name, type, positions: 1} and one port-mappings entry {front_port, front_port_position: 1, rear_port, rear_port_position} per front port; front_port and rear_port name ports of the same document. type: 8p8c, 110-punch, lc, lc-apc, sc, sc-apc, st, fc, mpo, mtrj or splice. Each slot of a rear port takes at most one front port.
- power-ports type: e.g. dc-terminal or iec-60320-c14; add maximum_draw only if stated in the datasheet. power-outlets use the documented NetBox connector type.
- description: one line, at most 200 characters. comments: Markdown source links, at most 2000 characters. Port descriptions: at most 200 characters.

End outside the YAML block with: sources, upstream hit/miss for both libraries, uncertain fields and file path. Mark DRAFT if not found in either library or primary sources.`
}
