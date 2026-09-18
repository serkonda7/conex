import { constants } from 'node:fs'
import { access, readFile, writeFile } from 'node:fs/promises'

type RootPackageJson = {
	workspaces?: string[]
}

const packageJsonPath = 'package.json'

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as RootPackageJson

const workspaces: string[] = packageJson.workspaces ?? []
const kept: string[] = []

for (const workspace of workspaces) {
	try {
		await access(`${workspace}/package.json`, constants.F_OK)
		kept.push(workspace)
	} catch {
		// Ignore missing workspace package manifests in pruned Docker contexts.
	}
}

packageJson.workspaces = kept

await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
