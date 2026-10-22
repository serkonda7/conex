declare module '*.css'
declare module '*.svg' {
	const src: string
	export default src
}
declare module '*.svg?raw' {
	const markup: string
	export default markup
}

/** Build info injected by Vite `define` (see vite.config.ts). */
declare const __APP_VERSION__: string
declare const __APP_COMMIT__: string
declare const __BUILD_TIME__: number
