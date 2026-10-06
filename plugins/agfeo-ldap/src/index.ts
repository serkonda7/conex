import net from 'node:net'
import tls from 'node:tls'
import { Result } from 'better-result'
import { elementSize } from './ber'
import { Conex, type ConexError, type Login } from './conex'
import { type Config, loadConfig } from './config'
import {
	baseEntry,
	contactEntry,
	type Entry,
	isWithin,
	matches,
	normalizeDn,
	parentDn,
	rootDse,
	selectAttributes,
} from './directory'
import {
	bindResponse,
	decodeMessage,
	filterToString,
	type Message,
	RESULT,
	resultMessage,
	type SearchRequest,
	searchDone,
	searchEntry,
} from './protocol'

// ---------------------------------------------------------------------------
// Read-only LDAP server publishing the conex contact directory for the AGFEO
// Dashboard. Binds are conex logins (see `conex.ts`); contacts come from the
// conex API with that login's permissions and tenant scope.
// ---------------------------------------------------------------------------

/** Larger requests are no LDAP client we serve; the connection is dropped. */
const MAX_MESSAGE_SIZE = 64 * 1024
const IDLE_TIMEOUT_MS = 5 * 60 * 1000

interface Session {
	/** conex login of the last successful bind; `null` = anonymous. */
	login: Login | null
	remote: string
}

/** conex username of a bind: the value of the first RDN (`uid=agfeo,…`) or the plain name. */
export function bindUsername(name: string): string {
	const rdn = name.split(',')[0] ?? ''
	const eq = rdn.indexOf('=')
	return (eq === -1 ? rdn : rdn.slice(eq + 1)).trim()
}

/** LDAP result code for a failed conex call. */
function resultCode(e: ConexError): number {
	switch (e.status) {
		case 401:
			return RESULT.invalidCredentials
		case 403:
			return RESULT.insufficientAccessRights
		case 429:
			return RESULT.busy
		default:
			return RESULT.unavailable
	}
}

async function handleBind(
	conex: Conex,
	session: Session,
	id: number,
	req: Extract<Message['request'], { type: 'bind' }>,
): Promise<Uint8Array> {
	session.login = null
	if (req.version !== 3) {
		return bindResponse(id, RESULT.protocolError, 'Only LDAPv3 is supported')
	}
	if (req.password === null) {
		return bindResponse(id, RESULT.authMethodNotSupported, 'Only simple bind is supported')
	}
	const username = bindUsername(req.name)
	if (username === '' && req.password === '') {
		// Anonymous: may read the root DSE only.
		return bindResponse(id, RESULT.success)
	}
	if (req.password === '') {
		return bindResponse(id, RESULT.unwillingToPerform, 'Unauthenticated bind is not allowed')
	}
	const login = await conex.bind(username, req.password)
	if (Result.isError(login)) {
		console.warn(`Failed bind from ${session.remote} as "${req.name}": ${login.error.message}`)
		return bindResponse(id, resultCode(login.error))
	}
	session.login = login.value
	return bindResponse(id, RESULT.success)
}

async function handleSearch(
	cfg: Config,
	conex: Conex,
	session: Session,
	id: number,
	req: SearchRequest,
): Promise<Uint8Array[]> {
	const base = normalizeDn(req.base)
	if (cfg.debug) {
		console.log(
			`${session.remote} search base="${req.base}" scope=${req.scope} filter=${filterToString(req.filter)} attrs=[${req.attributes.join(',')}] sizeLimit=${req.sizeLimit}`,
		)
	}

	if (base === '' && req.scope === 'base') {
		const entry = rootDse(cfg.baseDn)
		return matches(req.filter, entry) === true
			? [
					searchEntry(id, '', selectAttributes(entry, req.attributes, req.typesOnly)),
					searchDone(id, RESULT.success),
				]
			: [searchDone(id, RESULT.success)]
	}
	if (session.login === null) {
		return [searchDone(id, RESULT.insufficientAccessRights, 'Bind required')]
	}
	// The base must be our tree, an ancestor of it, or an entry in it.
	if (!isWithin(cfg.baseDn, base) && !isWithin(base, cfg.baseDn)) {
		return [searchDone(id, RESULT.noSuchObject)]
	}

	const entries: Entry[] = [baseEntry(cfg.baseDn)]
	// Only the base entry and its ancestors are visible without contacts.
	const needsContacts = !(req.scope === 'base' && isWithin(cfg.baseDn, base))
	if (needsContacts) {
		const rows = await conex.contacts(session.login)
		if (Result.isError(rows)) {
			console.error(`${session.remote}: ${rows.error.message}`)
			return [searchDone(id, resultCode(rows.error), 'Contacts unavailable')]
		}
		entries.push(...rows.value.map((row) => contactEntry(row, cfg.baseDn)))
	}

	if (isWithin(base, cfg.baseDn) && !entries.some((e) => e.dn === base)) {
		return [searchDone(id, RESULT.noSuchObject, '', cfg.baseDn)]
	}
	const inScope = entries.filter((e) => {
		if (req.scope === 'base') {
			return e.dn === base
		}
		return req.scope === 'one' ? parentDn(e.dn) === base : isWithin(e.dn, base)
	})

	const limit = req.sizeLimit > 0 ? Math.min(req.sizeLimit, cfg.maxResults) : cfg.maxResults
	const out: Uint8Array[] = []
	let found = 0
	for (const entry of inScope) {
		if (matches(req.filter, entry) !== true) {
			continue
		}
		if (found === limit) {
			out.push(searchDone(id, RESULT.sizeLimitExceeded))
			return out
		}
		found++
		out.push(searchEntry(id, entry.dn, selectAttributes(entry, req.attributes, req.typesOnly)))
	}
	if (cfg.debug) {
		console.log(`${session.remote} search returned ${found} entries`)
	}
	out.push(searchDone(id, RESULT.success))
	return out
}

/** Answers one message; `null` closes the connection (unbind). */
async function handle(
	cfg: Config,
	conex: Conex,
	session: Session,
	msg: Message,
): Promise<Uint8Array[] | null> {
	const req = msg.request
	switch (req.type) {
		case 'bind':
			return [await handleBind(conex, session, msg.id, req)]
		case 'search':
			return handleSearch(cfg, conex, session, msg.id, req)
		case 'unbind':
			return null
		case 'abandon':
		case 'ignored':
			return []
		case 'unsupported':
			return [
				resultMessage(
					msg.id,
					req.responseTag,
					RESULT.unwillingToPerform,
					'Read-only directory',
				),
			]
	}
}

function serveConnection(cfg: Config, conex: Conex, socket: net.Socket): void {
	const session: Session = {
		login: null,
		remote: `${socket.remoteAddress}:${socket.remotePort}`,
	}
	let buffer = Buffer.alloc(0)
	// Requests are answered in order, one at a time.
	let queue: Promise<void> = Promise.resolve()

	socket.setTimeout(IDLE_TIMEOUT_MS, () => socket.destroy())
	socket.on('error', (e) => {
		if (cfg.debug) {
			console.warn(`${session.remote}: ${e.message}`)
		}
	})
	socket.on('data', (chunk: Buffer) => {
		buffer = Buffer.concat([buffer, chunk])
		while (buffer.length > 0) {
			let size: number | null
			try {
				size = elementSize(buffer)
			} catch {
				socket.destroy()
				return
			}
			if (size === null) {
				if (buffer.length > MAX_MESSAGE_SIZE) {
					socket.destroy()
				}
				return
			}
			const decoded = decodeMessage(buffer.subarray(0, size))
			buffer = buffer.subarray(size)
			if (Result.isError(decoded)) {
				if (cfg.debug) {
					console.warn(`${session.remote}: ${decoded.error.message}`)
				}
				socket.destroy()
				return
			}
			queue = queue.then(async () => {
				if (socket.destroyed) {
					return
				}
				const responses = await handle(cfg, conex, session, decoded.value)
				if (responses === null) {
					socket.end()
					return
				}
				for (const r of responses) {
					socket.write(r)
				}
			})
			queue = queue.catch((e: unknown) => {
				console.error(`${session.remote}: ${e instanceof Error ? e.message : String(e)}`)
				socket.destroy()
			})
		}
	})
}

if (import.meta.main) {
	const cfgRes = loadConfig()
	if (Result.isError(cfgRes)) {
		console.error(`Failed to start: ${cfgRes.error.message}`)
		process.exit(1)
	}
	const cfg = cfgRes.value

	// Fail fast on a wrong conex URL.
	const health = await Result.tryPromise({
		try: () => fetch(`${cfg.conexUrl}/health`, { signal: AbortSignal.timeout(10_000) }),
		catch: (e: unknown) => new Error(e instanceof Error ? e.message : String(e)),
	})
	if (Result.isError(health) || !health.value.ok) {
		const reason = Result.isError(health) ? health.error.message : `HTTP ${health.value.status}`
		console.error(`Failed to start: conex not reachable at ${cfg.conexUrl} (${reason})`)
		process.exit(1)
	}

	const conex = new Conex(cfg.conexUrl)
	const onConnection = (socket: net.Socket): void => serveConnection(cfg, conex, socket)
	const server = cfg.tls
		? tls.createServer({ cert: cfg.tls.cert, key: cfg.tls.key }, onConnection)
		: net.createServer(onConnection)
	server.on('error', (e) => {
		console.error(`Failed to start: ${e.message}`)
		process.exit(1)
	})
	server.listen(cfg.port, cfg.host, () => {
		console.log(
			`AGFEO LDAP ${cfg.tls ? 'ldaps' : 'ldap'}://${cfg.host}:${cfg.port} base "${cfg.baseDn}", conex ${cfg.conexUrl}`,
		)
	})

	const shutdown = (): void => {
		server.close()
		process.exit(0)
	}
	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
}
