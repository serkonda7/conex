/**
 * Logic for finding the server root directory to locate data and migration files.
 * This is required as working directory might differ across local development and server-cli.
 *
 * Importing this module has no side effects: use `get_server_root()` during
 * startup and pass the resolved root explicitly.
 */

import fs from 'node:fs'
import path from 'node:path'
import { Result } from 'better-result'

const MARKERS = ['drizzle', 'data']

/**
 * Check if directory contains any marker files
 */
function contains_markers(dir: string): boolean {
	return MARKERS.some((marker) => fs.existsSync(path.join(dir, marker)))
}

/**
 * Find server root directory by looking for marker files.
 *
 * Pure lookup — no module-load side effects. Call during startup and handle
 * the Err with a readable message instead of throwing at import time.
 */
export function get_server_root(): Result<string, Error> {
	// Check working directory
	const cwd = process.cwd()
	if (contains_markers(cwd)) {
		return Result.ok(cwd)
	}

	// Check server subdirectory
	const serverPath = path.join(cwd, 'server')
	if (contains_markers(serverPath)) {
		return Result.ok(serverPath)
	}

	return Result.err(
		new Error(
			`Server root not found (looked for ${MARKERS.join('/')} markers in ${cwd} and ${serverPath}). Run from the repo root or server/ so data and drizzle/ resolve.`,
		),
	)
}

/**
 * Reads an env var trimmed, treating missing/blank as unset. The path
 * resolutions (`db.ts`, `index.ts`) all trimmed inline before; they share
 * this now so blank-vs-unset cannot diverge.
 */
export function getTrimmedEnv(name: string): string | undefined {
	const raw = Bun.env[name]?.trim()
	return raw ? raw : undefined
}

/**
 * Resolves a data-dir-relative file env value against an explicit server root:
 * absolute paths pass through, anything else is anchored at `<root>/data`.
 *
 * Takes the root as a parameter so importing this module never touches the
 * filesystem — callers resolve `get_server_root()` once during startup.
 */
export function resolveInDataDir(serverRoot: string, configured_path: string): string {
	if (path.isAbsolute(configured_path)) {
		return configured_path
	}
	return path.join(serverRoot, 'data', configured_path)
}
