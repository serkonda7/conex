import { Result } from 'better-result'
import { initDb } from 'server/src/db'
import { isUniqueViolation } from 'server/src/db/errors'
import { createLocalUser, getUserByEmail } from 'server/src/db/users'
import { normalize_email } from 'server/src/util/email'
import { prompt_line } from 'shared/src/prompt'

// Explicit startup instead of lazy imports: db.ts no longer opens the
// database on import, so initialize once up front.
try {
	initDb()
} catch (err) {
	const msg = err instanceof Error ? err.message : String(err)
	console.error(`Error: ${msg}`)
	process.exit(1)
}

async function createUserDb(email: string, password: string): Promise<Result<void, Error>> {
	const normalizedEmail = normalize_email(email)
	if (!normalizedEmail || !password) {
		return Result.err(new Error('Email and password are required.'))
	}

	if (getUserByEmail(normalizedEmail)) {
		return Result.err(new Error(`User ${normalizedEmail} already exists.`))
	}

	try {
		console.log(`Creating user ${normalizedEmail}...`)
		const password_hash = await Bun.password.hash(password)
		createLocalUser(normalizedEmail, password_hash)

		console.log('ok')
		return Result.ok(undefined)
	} catch (error: unknown) {
		if (isUniqueViolation(error)) {
			return Result.err(new Error(`User ${normalizedEmail} already exists.`))
		}
		const msg = error instanceof Error ? error.message : String(error)
		return Result.err(new Error(`Failed to create user: ${msg}`))
	}
}

async function askPassword(): Promise<string> {
	// Interactive collection avoids shell history leaks; mechanics in shared.
	return prompt_line('Password: ')
}

function printUsage(): void {
	console.log(`
Usage: cli.bin [command] [options]

Commands:
  create-user <email>    Create a new user (password is prompted interactively)
  help                   Show this help message
`)
}

async function main(args: string[]): Promise<Result<void, Error>> {
	if (args.length === 0) {
		printUsage()
		return Result.ok(undefined)
	}

	const command = args[0]

	if (command === 'create-user') {
		if (args.length !== 2) {
			return Result.err(new Error('Usage: create-user <email>'))
		}

		// Always collect password interactively to avoid shell history leaks.
		const password = await askPassword()
		if (!password) {
			return Result.err(new Error('Password cannot be empty'))
		}

		return await createUserDb(args[1], password)
	}

	if (command === 'help' || command === '-h' || command === '--help') {
		printUsage()
		return Result.ok(undefined)
	}

	return Result.err(new Error(`Unknown command: ${command}`))
}

if (import.meta.main) {
	const result = await main(Bun.argv.slice(2))

	if (Result.isError(result)) {
		console.error(`Error: ${result.error.message}`)
		process.exit(1)
	}

	process.exit(0)
}
