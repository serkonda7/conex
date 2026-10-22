/** Schematic drawings of the NetBox rack form factors, previewed in the form
 * factor select. The SVG files are shared with the docs (`docs/src/racks.md`);
 * they draw in `currentColor`, so inline they follow the text color. */
import type { JSX } from 'solid-js'
import twoPostFrame from '../../../docs/src/img/rack-2-post-frame-schematic.svg?raw'
import fourPostCabinet from '../../../docs/src/img/rack-4-post-cabinet-schematic.svg?raw'
import fourPostFrame from '../../../docs/src/img/rack-4-post-frame-schematic.svg?raw'
import wallCabinet from '../../../docs/src/img/rack-wall-mounted-cabinet-schematic.svg?raw'
import wallFrame from '../../../docs/src/img/rack-wall-mounted-frame-schematic.svg?raw'
import type { RackFormFactor } from '../api/templates'

const SCHEMATICS: Record<RackFormFactor, string> = {
	'2-post frame': twoPostFrame,
	'4-post frame': fourPostFrame,
	'4-post cabinet': fourPostCabinet,
	'wall-mounted frame': wallFrame,
	'wall-mounted cabinet': wallCabinet,
}

/** Line drawing of one form factor (64px). */
export function RackFormFactorSchematic(props: { formFactor: RackFormFactor }): JSX.Element {
	// Build-time assets from the repo, not user content.
	return <span class="rack-form-factor-schematic" innerHTML={SCHEMATICS[props.formFactor]} />
}
