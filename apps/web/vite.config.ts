import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
	plugins: [solid()],
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
