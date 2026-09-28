/**
 * Schedules a periodic background sweep.
 *
 * Sessions sweep on an interval; the timer must not
 * keep the process alive (tests import these modules without running a
 * server), so the single helper owns the `.unref()` instead of each call site.
 */
export function start_sweep(task: () => Promise<unknown>, intervalMs: number): void {
	setInterval(() => {
		// A failed sweep (e.g. DB briefly unreachable) must not crash the server.
		task().catch((err: unknown) => console.error('Periodic sweep failed:', err))
	}, intervalMs).unref()
}
