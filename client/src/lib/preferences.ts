/**
 * Per-user UI preferences, stored in localStorage under the signed-in
 * username so accounts sharing a browser keep their own choices. Loaded by
 * the app shell on sign-in; defaults apply until then and after sign-out.
 */
import { createSignal } from 'solid-js'
import { readStored, writeStored } from './storage'

const OPEN_ITEMS_KEY = 'conex:openItemsInNewTab'

let currentUser: string | null = null

const [openItemsInNewTab, setOpenItemsInNewTabState] = createSignal(false)

/** Whether links to an item (an object's detail page) open in a new browser tab. Off by default. */
export { openItemsInNewTab }

function userKey(key: string, username: string): string {
	return `${key}:${username}`
}

/** Loads the preferences of `username`, or resets them to the defaults for null (signed out). */
export function loadUserPreferences(username: string | null): void {
	currentUser = username
	setOpenItemsInNewTabState(
		username !== null && readStored(userKey(OPEN_ITEMS_KEY, username)) === 'true',
	)
}

/** Turns opening items in a new browser tab on or off for the signed-in user. */
export function setOpenItemsInNewTab(on: boolean): void {
	setOpenItemsInNewTabState(on)
	if (currentUser !== null) {
		writeStored(userKey(OPEN_ITEMS_KEY, currentUser), on ? 'true' : 'false')
	}
}
