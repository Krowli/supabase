import { useQuery } from '@tanstack/react-query'

import { databaseKeys } from './keys'
import { get, handleError } from '@/data/fetchers'
import type { ResponseError, UseCustomQueryOptions } from '@/types'

export type PgbouncerConfigVariables = {
  projectRef?: string
}

export async function getPgbouncerConfig(
  { projectRef }: PgbouncerConfigVariables,
  signal?: AbortSignal
) {
  if (!projectRef) throw new Error('projectRef is required')

  const { data, error } = await get('/platform/projects/{ref}/config/pgbouncer', {
    params: { path: { ref: projectRef } },
    signal,
  })
  if (error) handleError(error)
  return data
}

export type PgbouncerConfigData = Awaited<ReturnType<typeof getPgbouncerConfig>>
export type PgbouncerConfigError = ResponseError

export const usePgbouncerConfigQuery = <TData = PgbouncerConfigData>(
  { projectRef }: PgbouncerConfigVariables,
  {
    enabled = true,
    ...options
  }: UseCustomQueryOptions<PgbouncerConfigData, PgbouncerConfigError, TData> = {}
) =>
  useQuery<PgbouncerConfigData, PgbouncerConfigError, TData>({
    queryKey: databaseKeys.pgbouncerConfig(projectRef),
    queryFn: ({ signal }) => getPgbouncerConfig({ projectRef }, signal),
    // No `IS_PLATFORM` gate: self-hosted this endpoint is served by
    // `pages/api/platform/projects/[ref]/config/pgbouncer.ts`, which reads and writes the Supavisor
    // tenant over its admin API.
    enabled: enabled && typeof projectRef !== 'undefined',
    ...options,
  })
