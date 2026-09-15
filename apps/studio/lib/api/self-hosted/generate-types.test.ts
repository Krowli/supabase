import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_EXPOSED_SCHEMAS } from './constants'
import { generateTypescriptTypes } from './generate-types'

vi.mock('@/data/fetchers', () => ({
  fetchGet: vi.fn(),
}))

vi.mock('@/lib/constants', () => ({
  PG_META_URL: 'http://localhost:8080',
}))

vi.mock('./util', () => ({
  assertSelfHosted: vi.fn(),
}))

// The exposed schemas are read from the database rather than from PGRST_DB_SCHEMAS, because the
// settings page can change them. Mocked at the query so the whole path is exercised.
const { executeQuery } = vi.hoisted(() => ({ executeQuery: vi.fn() }))
vi.mock('./query', () => ({ executeQuery }))

/** A distinctive, non-default value, so an assertion cannot pass on the default by accident. */
const EXPOSED_SCHEMAS = 'public,custom_schema,graphql_public'

const withRoleSettings = (...settings: string[]) => {
  executeQuery.mockResolvedValue({
    data: settings.map((setting) => ({ setdatabase: 0, setting })),
    error: undefined,
  })
}

describe('api/self-hosted/generate-types', () => {
  let mockFetchGet: ReturnType<typeof vi.fn>
  let mockAssertSelfHosted: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    const fetchers = await import('@/data/fetchers')
    const util = await import('./util')

    mockFetchGet = vi.mocked(fetchers.fetchGet)
    mockAssertSelfHosted = vi.mocked(util.assertSelfHosted)

    executeQuery.mockReset()
    withRoleSettings(`pgrst.db_schemas=${EXPOSED_SCHEMAS}`)
  })

  describe('generateTypescriptTypes', () => {
    it('should call assertSelfHosted', async () => {
      mockFetchGet.mockResolvedValue({ types: 'export type User = {}' })

      await generateTypescriptTypes({ headers: {} })

      expect(mockAssertSelfHosted).toHaveBeenCalled()
    })

    it('should request types for the schemas the Data API exposes', async () => {
      mockFetchGet.mockResolvedValue({ types: 'export type User = {}' })

      await generateTypescriptTypes({ headers: {} })

      const callUrl = mockFetchGet.mock.calls[0][0]
      expect(callUrl).toContain('http://localhost:8080/generators/typescript')
      // Forwards the exposed-schemas config verbatim as the plural allowlist param.
      expect(callUrl).toContain(`included_schemas=${EXPOSED_SCHEMAS}`)
      // No hardcoded exclude list — the exposed-schemas config is the source of truth.
      expect(callUrl).not.toContain('excluded_schemas=')
    })

    it('should follow a schema list changed from the settings page', async () => {
      // The point of reading from the database: a schema exposed after the container started is in
      // the generated types, where PGRST_DB_SCHEMAS at import time would have missed it.
      withRoleSettings('pgrst.db_schemas=public,newly_exposed')
      mockFetchGet.mockResolvedValue({ types: 'export type User = {}' })

      await generateTypescriptTypes({ headers: {} })

      expect(mockFetchGet.mock.calls[0][0]).toContain('included_schemas=public,newly_exposed')
    })

    it('should not carry the spaces a save stores into the pg-meta URL', async () => {
      // From the first save on the role setting reads back `public, newly_exposed`: the spaced form
      // the settings page shows. Interpolated as it stands, pg-meta is asked for a schema called
      // " newly_exposed" and answers with the types for `public` alone.
      withRoleSettings('pgrst.db_schemas="public, newly_exposed"')
      mockFetchGet.mockResolvedValue({ types: 'export type User = {}' })

      await generateTypescriptTypes({ headers: {} })

      const callUrl = mockFetchGet.mock.calls[0][0]
      expect(callUrl).toContain('included_schemas=public,newly_exposed')
      expect(callUrl).not.toContain(' ')
    })

    it('should fall back to the container env when the database cannot be reached', async () => {
      executeQuery.mockResolvedValue({ data: undefined, error: new Error('connection refused') })
      mockFetchGet.mockResolvedValue({ types: 'export type User = {}' })

      await generateTypescriptTypes({ headers: {} })

      expect(mockFetchGet.mock.calls[0][0]).toContain(`included_schemas=${DEFAULT_EXPOSED_SCHEMAS}`)
    })

    it('should pass headers to fetchGet', async () => {
      mockFetchGet.mockResolvedValue({ types: 'export type User = {}' })

      const customHeaders = {
        Authorization: 'Bearer token',
        'Custom-Header': 'value',
      }

      await generateTypescriptTypes({ headers: customHeaders })

      expect(mockFetchGet).toHaveBeenCalledWith(expect.any(String), {
        headers: customHeaders,
      })
    })

    it('should return types from fetchGet response', async () => {
      const mockTypes = 'export type User = { id: number; name: string }'
      mockFetchGet.mockResolvedValue({ types: mockTypes })

      const result = await generateTypescriptTypes({ headers: {} })

      expect(result).toEqual({ types: mockTypes })
    })

    it('should handle fetchGet errors', async () => {
      const mockError = new Error('Network error')
      mockFetchGet.mockRejectedValue(mockError)

      await expect(generateTypescriptTypes({ headers: {} })).rejects.toThrow('Network error')
    })

    it('should work without headers parameter', async () => {
      mockFetchGet.mockResolvedValue({ types: '' })

      await generateTypescriptTypes({})

      expect(mockFetchGet).toHaveBeenCalledWith(expect.any(String), { headers: undefined })
    })
  })
})
