# @serkonda7/conex-device-schema

The rules conex applies when importing device-type YAML: `DeviceTypeYamlSchema`, the port and
type constants, and the port rules. Conex uses it as a workspace package,
[conex-device-types](https://github.com/serkonda7/conex-device-types) installs a published version.

```ts
import { validateDeviceType } from '@serkonda7/conex-device-schema'

validateDeviceType(Bun.YAML.parse(text)) // null, or why conex would refuse the definition
```

The package ships TypeScript source, so it needs a runtime or bundler that reads it, such as Bun.

## Release

Bump `version`, then run `bun publish` in this directory. Update the version in
conex-device-types to validate against the new rules.
