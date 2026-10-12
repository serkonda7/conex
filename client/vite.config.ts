import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import devtools from 'solid-devtools/vite'
import { defineConfig } from 'vite'
import entryShakingPlugin from 'vite-plugin-entry-shaking'
import solidPlugin from 'vite-plugin-solid'

const CLIENT_PORT = Number(process.env.CONEX_CLIENT_PORT ?? 5371)

const rootPackage = JSON.parse(
	readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'),
) as { version: string }

/** Short hash of the checked-out commit; empty outside a git checkout. */
function gitCommit(): string {
	try {
		return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
	} catch {
		return ''
	}
}

const tablerIconsEntry = resolve(
	import.meta.dirname,
	'node_modules/@tabler/icons-solidjs/dist/source/icons/index.js',
)

export default defineConfig({
	plugins: [
		entryShakingPlugin({
			targets: [tablerIconsEntry],
		}),
		devtools(),
		solidPlugin(),
	],
	define: {
		__APP_VERSION__: JSON.stringify(rootPackage.version),
		__APP_COMMIT__: JSON.stringify(gitCommit()),
		__BUILD_TIME__: JSON.stringify(Math.floor(Date.now() / 1000)),
	},
	resolve: {
		alias: {
			'@tabler/icons-solidjs': tablerIconsEntry,
		},
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
