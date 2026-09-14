import { createEffect, createSignal, onCleanup } from "solid-js";

/** Debounce a string signal (e.g. search input) for query keys. */
export function useDebounced(source: () => string, delay = 250): () => string {
	const [value, setValue] = createSignal(source());
	let timer: number | undefined;
	createEffect(() => {
		const next = source();
		window.clearTimeout(timer);
		timer = window.setTimeout(() => setValue(next), delay);
	});
	onCleanup(() => window.clearTimeout(timer));
	return value;
}
