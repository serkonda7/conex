import { Result } from 'better-result'
import * as v from 'valibot'
import type { AppConfig } from '../config'
import { ExternalServiceError } from '../db/errors'
import { getTrimmedEnv } from '../util/server_root'
import { renderTranscript } from './prompt'
import type { AiModel, AiProvider, AiReply, AiRequest } from './provider'

type OpencodeConfig = NonNullable<AppConfig['ai']>['opencode']

// `opencode serve` uses HTTP Basic auth with this fixed user name.
const OPENCODE_USER = 'opencode'

// Listing models is quick; generation uses `timeoutSeconds` instead.
const LIST_TIMEOUT_MS = 15_000

const GenerateResponseSchema = v.object({ data: v.object({ text: v.string() }) })
const ModelListResponseSchema = v.object({
	data: v.array(
		v.object({
			id: v.string(),
			providerID: v.string(),
			name: v.string(),
			enabled: v.optional(v.boolean(), true),
		}),
	),
})
const ErrorResponseSchema = v.object({ _tag: v.string(), message: v.optional(v.string()) })

/**
 * An `opencode serve` instance through its stateless text generation
 * endpoint (`POST /api/experimental/generate/text`): one model call with
 * opencode's own provider credentials, no session, no agent tools. The
 * endpoint takes a single prompt, so system prompt and history are rendered
 * into it. Password: `password` from the config, else
 * `OPENCODE_SERVER_PASSWORD`.
 */
export function createOpencodeProvider(cfg: OpencodeConfig): Result<AiProvider, Error> {
	const endpoint = `${baseUrl(cfg)}/api/experimental/generate/text`
	const model = parseModel(cfg.model)

	return Result.ok({
		id: 'opencode',
		model: cfg.model ?? null,
		async generate(req: AiRequest, signal?: AbortSignal): Promise<Result<AiReply, Error>> {
			const timeout = AbortSignal.timeout(cfg.timeoutSeconds * 1000)
			let res: Response
			try {
				res = await fetch(endpoint, {
					method: 'POST',
					headers: { 'content-type': 'application/json', ...authHeader(cfg) },
					body: JSON.stringify({
						prompt: renderTranscript(req),
						...(model && { model }),
					}),
					signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
				})
			} catch (err) {
				if (timeout.aborted) {
					return Result.err(new ExternalServiceError('opencode did not answer in time'))
				}
				if (signal?.aborted) {
					return Result.err(new Error('opencode request aborted'))
				}
				return Result.err(
					new ExternalServiceError(`opencode is unreachable: ${(err as Error).message}`),
				)
			}

			const body: unknown = await res.json().catch(() => null)
			if (!res.ok) {
				return Result.err(new ExternalServiceError(opencodeError(res.status, body)))
			}
			const parsed = v.safeParse(GenerateResponseSchema, body)
			if (!parsed.success) {
				return Result.err(
					new ExternalServiceError('opencode returned an unexpected response'),
				)
			}
			return Result.ok({
				text: parsed.output.data.text,
				model: cfg.model ?? 'opencode default',
				// The endpoint does not report a stop reason.
				truncated: false,
			})
		},
	})
}

/**
 * Chat models of the providers opencode has enabled (`GET /api/model`), as
 * `"<providerID>/<modelID>"` references.
 */
export async function listOpencodeModels(cfg: OpencodeConfig): Promise<Result<AiModel[], Error>> {
	let res: Response
	try {
		res = await fetch(`${baseUrl(cfg)}/api/model`, {
			headers: authHeader(cfg),
			signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
		})
	} catch (err) {
		return Result.err(
			new ExternalServiceError(`opencode is unreachable: ${(err as Error).message}`),
		)
	}
	const body: unknown = await res.json().catch(() => null)
	if (!res.ok) {
		return Result.err(new ExternalServiceError(opencodeError(res.status, body)))
	}
	const parsed = v.safeParse(ModelListResponseSchema, body)
	if (!parsed.success) {
		return Result.err(new ExternalServiceError('opencode returned an unexpected response'))
	}
	return Result.ok(
		parsed.output.data
			.filter((m) => m.enabled)
			.map((m) => ({ id: `${m.providerID}/${m.id}`, name: m.name })),
	)
}

function baseUrl(cfg: OpencodeConfig): string {
	return cfg.url.replace(/\/+$/, '')
}

/** Password: `password` from the config, else `OPENCODE_SERVER_PASSWORD`. */
function authHeader(cfg: OpencodeConfig): Record<string, string> {
	const password = cfg.password ?? getTrimmedEnv('OPENCODE_SERVER_PASSWORD')
	return password ? { authorization: `Basic ${btoa(`${OPENCODE_USER}:${password}`)}` } : {}
}

/** `"<providerID>/<modelID>"` (the model id may itself contain slashes). */
function parseModel(ref: string | undefined): { providerID: string; id: string } | undefined {
	if (!ref) {
		return undefined
	}
	const slash = ref.indexOf('/')
	return { providerID: ref.slice(0, slash), id: ref.slice(slash + 1) }
}

function opencodeError(status: number, body: unknown): string {
	if (status === 401) {
		return 'opencode rejected the password (OPENCODE_SERVER_PASSWORD)'
	}
	const parsed = v.safeParse(ErrorResponseSchema, body)
	const detail = parsed.success ? `${parsed.output._tag}: ${parsed.output.message ?? ''}` : ''
	return `opencode error ${status}${detail ? ` (${detail.trim()})` : ''}`
}
