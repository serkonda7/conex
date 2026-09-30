/** Transfer API wrapper: NetBox YAML device-type import. */
import type { Result } from 'better-result'
import type { ImportResponse } from 'shared/src/types'
import { t, tp } from '../i18n'
import { post_json } from './client'

export type { ImportResponse }

/** Uploads a NetBox device-type YAML document or collection. */
export async function upload_yaml(yaml: string): Promise<Result<ImportResponse, Error>> {
	return post_json<ImportResponse>(
		'/api/device-types/import',
		{ yaml },
		t('api.importFailed', { noun: tp('noun.deviceType', 2) }),
	)
}
