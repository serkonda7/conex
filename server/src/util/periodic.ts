/**
 * Schedules a periodic background sweep.
 *
 * Sessions sweep on an interval; the timer must not
 * keep the process alive (tests import these modules without running a
 * server), so the single helper owns the `.unref()` instead of each call site.
 */
export function start_sweep(task: () => void, intervalMs: number): void {
	setInterval(task, intervalMs).unref()
}
