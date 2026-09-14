import { resolve } from "node:path";
import { defineConfig } from "vite";
import entryShakingPlugin from "vite-plugin-entry-shaking";
import solid from "vite-plugin-solid";

const tablerIconsEntry = resolve(
	import.meta.dirname,
	"node_modules/@tabler/icons-solidjs/dist/source/icons/index.js",
);

export default defineConfig({
	plugins: [
		entryShakingPlugin({
			targets: [tablerIconsEntry],
		}),
		solid(),
	],
	resolve: {
		alias: {
			"@tabler/icons-solidjs": tablerIconsEntry,
		},
	},
	server: {
		port: 5173,
		proxy: {
			"/api": {
				target: process.env.VITE_API_URL ?? "http://localhost:3001",
				changeOrigin: true,
			},
		},
	},
	preview: { port: 5173 },
});
