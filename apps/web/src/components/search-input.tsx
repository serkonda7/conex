import type { JSX } from "solid-js";
import { onCleanup, onMount } from "solid-js";
import { IconSearch } from "solid-tabler-icons";

/**
 * Search input with Cmd+K / Ctrl+K focus shortcut.
 * Debouncing is the caller's job (see useDebounced).
 */
export function SearchInput(props: {
	value: string;
	placeholder?: string;
	onInput: (value: string) => void;
}): JSX.Element {
	let input!: HTMLInputElement;
	onMount(() => {
		const handler = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				input.focus();
				input.select();
			}
		};
		window.addEventListener("keydown", handler);
		onCleanup(() => window.removeEventListener("keydown", handler));
	});
	return (
		<div class="search">
			<IconSearch size={16} class="search-icon" aria-hidden="true" />
			<input
				ref={input}
				type="search"
				class="input search-input"
				placeholder={props.placeholder ?? "Search…  (⌘K)"}
				value={props.value}
				onInput={(e) => props.onInput(e.currentTarget.value)}
			/>
		</div>
	);
}
