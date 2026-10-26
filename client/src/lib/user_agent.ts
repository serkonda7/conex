const BROWSERS: [string, RegExp][] = [
	['Edge', /\bEdg(?:e|A|iOS)?\/(\d+)/],
	['Opera', /\b(?:OPR|Opera)\/(\d+)/],
	['Firefox', /\b(?:Firefox|FxiOS)\/(\d+)/],
	['Chrome', /\b(?:Chrome|CriOS)\/(\d+)/],
	['Safari', /\bVersion\/(\d+).*Safari\//],
	['curl', /^curl\/(\d+)/],
]

const SYSTEMS: [string, RegExp][] = [
	['Windows', /Windows/],
	['Android', /Android/],
	['iOS', /iPhone|iPad|iPod/],
	['macOS', /Mac OS X|Macintosh/],
	['Linux', /Linux|X11/],
]

/** Short `Chrome 156 · Linux` form of a User-Agent; falls back to the raw string. */
export function shortUserAgent(ua: string): string {
	const browser = BROWSERS.map(([name, re]) => {
		const m = re.exec(ua)
		return m ? `${name} ${m[1]}` : null
	}).find((b) => b !== null)
	const system = SYSTEMS.find(([, re]) => re.test(ua))?.[0]
	const parts = [browser, system].filter((p): p is string => Boolean(p))
	return parts.length > 0 ? parts.join(' · ') : ua
}
