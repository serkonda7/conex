import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tablerIcons } from '@serkonda7/solid-components/vite'
import devtools from 'solid-devtools/vite'
import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'

const CLIENT_PORT = Number(process.env.CONEX_CLIENT_PORT ?? 5371)

const rootPackage = JSON.parse(
	readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'),
) as { version: string }

/**
 * Short hash of the checked-out commit; empty for tagged releases and outside a
 * git checkout. `CONEX_COMMIT` overrides it (e.g. Docker builds without .git).
 */
function gitCommit(): string {
	if (process.env.CONEX_COMMIT !== undefined) {
		return process.env.CONEX_COMMIT
	}
	const git = (args: string): string =>
		execSync(`git ${args}`, { encoding: 'utf8', stdio: 'pipe' }).trim()
	try {
		git('describe --exact-match --tags HEAD')
		return ''
	} catch {
		// not on a tag
	}
	try {
		return git('rev-parse --short HEAD')
	} catch {
		return ''
	}
}

export default defineConfig({
	plugins: [devtools(), tablerIcons(), solidPlugin()],
	define: {
		__APP_VERSION__: JSON.stringify(rootPackage.version),
		__APP_COMMIT__: JSON.stringify(gitCommit()),
		__BUILD_TIME__: JSON.stringify(Math.floor(Date.now() / 1000)),
	},
	// A second dev server runs next to the default one during the e2e tests, so
	// port, API target and dep cache have to be overridable.
	cacheDir: `node_modules/.vite-${CLIENT_PORT}`,
	server: {
		port: CLIENT_PORT,
		proxy: {
			'/api': {
				target: process.env.CONEX_API_URL ?? 'http://localhost:3000',
				changeOrigin: true,
				rewrite: (path: string) => path.replace(/^\/api/, ''),
			},
		},
	},
	build: {
		target: 'esnext',
	},
})
