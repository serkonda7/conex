/**
 * Single-line terminal prompt shared by the CLIs.
 *
 * `server-cli` (password entry) wrapped `node:readline` inline before; the
 * readline mechanics live here while each caller keeps its own parsing
 * (empty-password rejection, y/N confirmation, TTY guards).
 */
import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'

/** Asks one line on the terminal and returns the raw answer. */
export async function prompt_line(question: string): Promise<string> {
	const rl = createInterface({ input, output, terminal: true })
	try {
		return await rl.question(question)
	} finally {
		rl.close()
	}
}
