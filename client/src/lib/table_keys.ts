import { routeSection } from '../app/routes'

// Table keys of the saved filters and layouts usually name a list section
// (`devices`, `sites`); other tables use their own key.

/** Localized name of a table key (its list section), or the raw key for unknown tables. */
export function tableLabel(table: string): string {
	const section = routeSection(`/${table}`)
	return section && section.path === table ? (section.navLabel?.() ?? section.noun(2)) : table
}

/** List page of a table key, when the key names a routed list. */
export function tableHref(table: string): string | undefined {
	const section = routeSection(`/${table}`)
	return section && section.path === table && section.list ? `/${table}` : undefined
}
