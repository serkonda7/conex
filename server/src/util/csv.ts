import { Result } from 'better-result'

/**
 * Minimal RFC-4180 CSV reader/writer for the P6 device/cable import/export
 * endpoints. No quoted-newline support on parse (one line = one row);
 * quoting on serialize follows the `"`-escape rule. Everything returns a
 * `Result`, never throws, per `AGENTS.md`.
 */

export function parseCsv(text: string): Result<{ header: string[]; rows: string[][] }, Error> {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0)
	if (lines.length === 0) {
		return Result.err(new Error('CSV is empty'))
	}
	const header = splitLine(lines[0] as string)
	if (header.length === 0) {
		return Result.err(new Error('CSV header is empty'))
	}
	const seen = new Set<string>()
	for (const col of header) {
		if (seen.has(col)) {
			return Result.err(new Error(`Duplicate CSV column "${col}"`))
		}
		seen.add(col)
	}
	const rows: string[][] = []
	for (let i = 1; i < lines.length; i++) {
		const cells = splitLine(lines[i] as string)
		if (cells.length !== header.length) {
			return Result.err(
				new Error(`Row ${i} has ${cells.length} cells but the header has ${header.length}`),
			)
		}
		rows.push(cells)
	}
	return Result.ok({ header, rows })
}

/** Splits one CSV line honoring double-quoted cells (`""` = literal `"`). */
function splitLine(line: string): string[] {
	const cells: string[] = []
	let current = ''
	let inQuotes = false
	for (let i = 0; i < line.length; i++) {
		const ch = line[i]
		if (inQuotes) {
			if (ch === '"') {
				if (line[i + 1] === '"') {
					current += '"'
					i++
				} else {
					inQuotes = false
				}
			} else {
				current += ch
			}
		} else if (ch === '"') {
			inQuotes = true
		} else if (ch === ',') {
			cells.push(current.trim())
			current = ''
		} else {
			current += ch
		}
	}
	cells.push(current.trim())
	return cells
}

/** Builds an object per row keyed by header name (empty cells become undefined). */
export function rowsToObjects(
	header: string[],
	rows: string[][],
): Record<string, string | undefined>[] {
	return rows.map((cells) => {
		const obj: Record<string, string | undefined> = {}
		for (let i = 0; i < header.length; i++) {
			const cell = cells[i] as string
			obj[header[i] as string] = cell === '' ? undefined : cell
		}
		return obj
	})
}

function escapeCell(value: string): string {
	if (/[",\r\n]/.test(value)) {
		return `"${value.replace(/"/g, '""')}"`
	}
	return value
}

/** Serializes a header plus string rows to CSV text (trailing newline). */
export function toCsv(header: string[], rows: (string | null)[][]): string {
	const lines = [header.map(escapeCell).join(',')]
	for (const row of rows) {
		lines.push(row.map((cell) => escapeCell(cell ?? '')).join(','))
	}
	return `${lines.join('\n')}\n`
}
