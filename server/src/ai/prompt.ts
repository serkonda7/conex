import type { AiRequest } from './provider'

/**
 * System prompt of the in-app assistant. Kept free of per-request values
 * (time, user) so providers can cache the prefix.
 */
export const ASSISTANT_SYSTEM_PROMPT = `You are the assistant built into conex, a web application that documents IT infrastructure: tenants, sites, locations, racks, devices, interfaces, cables, virtual machines and employees.

You cannot read or change conex data yet. When a question needs inventory data, say that you cannot look it up and point the user to the conex page where they can find it.

Answer in the language of the user's latest message. Format answers in Markdown.`

/**
 * Renders system prompt and conversation into one prompt, for providers
 * that take a single text (opencode's stateless generation).
 */
export function renderTranscript(req: AiRequest): string {
	const turns = req.messages.map((m) => `<${m.role}>\n${m.text}\n</${m.role}>`).join('\n\n')
	return `<system>\n${req.system}\n</system>\n\n<conversation>\n${turns}\n</conversation>\n\nWrite the assistant's reply to the last user message. Reply with the message text only.`
}
