import { createSignal } from 'solid-js'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'conex-theme'

function systemTheme(): Theme {
	if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
		return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
	}
	return 'light'
}

function storedTheme(): Theme | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		return raw === 'light' || raw === 'dark' ? raw : null
	} catch {
		return null
	}
}

function initialTheme(): Theme {
	if (typeof document !== 'undefined') {
		const attr = document.documentElement.getAttribute('data-theme')
		if (attr === 'light' || attr === 'dark') {
			return attr
		}
	}
	return storedTheme() ?? systemTheme()
}

export function applyTheme(next: Theme): void {
	document.documentElement.setAttribute('data-theme', next)
	document.documentElement.style.colorScheme = next
	try {
		localStorage.setItem(STORAGE_KEY, next)
	} catch {
		// Storage may be unavailable (private mode); theme still applies.
	}
}

const [theme, setThemeSignal] = createSignal<Theme>(initialTheme())

export function setTheme(next: Theme): void {
	setThemeSignal(next)
	if (typeof document !== 'undefined') {
		applyTheme(next)
	}
}

export function toggleTheme(): Theme {
	const next: Theme = theme() === 'dark' ? 'light' : 'dark'
	setTheme(next)
	return next
}

/** Apply the resolved theme on startup and follow OS changes until overridden. */
export function initTheme(): void {
	applyTheme(theme())
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
		return
	}
	const mq = window.matchMedia('(prefers-color-scheme: dark)')
	const onChange = (e: MediaQueryListEvent): void => {
		if (storedTheme() !== null) {
			return
		}
		setTheme(e.matches ? 'dark' : 'light')
	}
	if (typeof mq.addEventListener === 'function') {
		mq.addEventListener('change', onChange)
	}
}

export { theme }
