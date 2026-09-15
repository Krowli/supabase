import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_EXPOSED_SCHEMAS } from '@/lib/api/self-hosted/constants'
import { getDebuggingOperations } from '@/lib/api/self-hosted/mcp'

const mockGetLints = vi.fn()

// Mock getLints to capture what arguments the MCP operations pass
vi.mock('@/lib/api/self-hosted/lints', () => ({
  getLints: (...args: unknown[]) => mockGetLints(...args),
}))

// Mock getProjectSettings to avoid assertSelfHosted() check
vi.mock('@/lib/api/self-hosted/settings', () => ({
  getProjectSettings: () => ({
    app_config: {
      db_schema: 'public',
      endpoint: 'localhost',
      protocol: 'http',
    },
    service_api_keys: [{ api_key: 'test', name: 'anon key', tags: 'anon' }],
  }),
}))

// The exposed schemas come from the authenticator role rather than from PGRST_DB_SCHEMAS at import
// time, so the advisors follow a list changed from the settings page. Mocked at the query, so the
// whole path from role setting to getLints argument is exercised.
const { executeQuery } = vi.hoisted(() => ({ executeQuery: vi.fn() }))
vi.mock('@/lib/api/self-hosted/query', () => ({ executeQuery }))

const withRoleSettings = (...settings: string[]) => {
  executeQuery.mockResolvedValue({
    data: settings.map((setting) => ({ setdatabase: 0, setting })),
    error: undefined,
  })
}

describe('MCP advisor operations pass exposedSchemas to getLints', () => {
  const headers = { Authorization: 'Bearer test' }

  beforeEach(() => {
    mockGetLints.mockResolvedValue({
      data: [
        {
          name: 'rls_disabled_in_public',
          title: 'RLS Disabled in Public',
          level: 'ERROR',
          categories: ['SECURITY'],
          description: 'test',
          detail: 'test',
          remediation: 'test',
          metadata: {},
          cache_key: 'test',
        },
        {
          name: 'unindexed_foreign_keys',
          title: 'Unindexed foreign keys',
          level: 'INFO',
          categories: ['PERFORMANCE'],
          description: 'test',
          detail: 'test',
          remediation: 'test',
          metadata: {},
          cache_key: 'test',
        },
      ],
      error: undefined,
    })

    mockGetLints.mockClear()
    executeQuery.mockReset()
    withRoleSettings()
  })

  it('getSecurityAdvisors should pass exposedSchemas to getLints', async () => {
    const ops = getDebuggingOperations({ headers })
    await ops.getSecurityAdvisors('test-project')

    expect(mockGetLints).toHaveBeenCalledOnce()
    const callArgs = mockGetLints.mock.calls[0][0]
    expect(callArgs).toHaveProperty('exposedSchemas')
    expect(callArgs.exposedSchemas).toBeTruthy()
  })

  it('getPerformanceAdvisors should pass exposedSchemas to getLints', async () => {
    const ops = getDebuggingOperations({ headers })
    await ops.getPerformanceAdvisors('test-project')

    expect(mockGetLints).toHaveBeenCalledOnce()
    const callArgs = mockGetLints.mock.calls[0][0]
    expect(callArgs).toHaveProperty('exposedSchemas')
    expect(callArgs.exposedSchemas).toBeTruthy()
  })

  it('should use the schemas the Data API exposes', async () => {
    withRoleSettings('pgrst.db_schemas=public,newly_exposed')

    const ops = getDebuggingOperations({ headers })
    await ops.getSecurityAdvisors('test-project')

    const callArgs = mockGetLints.mock.calls[0][0]
    expect(callArgs.exposedSchemas).toBe('public,newly_exposed')
  })

  it('should fall back to DEFAULT_EXPOSED_SCHEMAS when the database cannot be reached', async () => {
    executeQuery.mockResolvedValue({ data: undefined, error: new Error('connection refused') })

    const ops = getDebuggingOperations({ headers })
    await ops.getPerformanceAdvisors('test-project')

    const callArgs = mockGetLints.mock.calls[0][0]
    expect(callArgs.exposedSchemas).toBe(DEFAULT_EXPOSED_SCHEMAS)
  })

  it('getSecurityAdvisors should filter to SECURITY category', async () => {
    const ops = getDebuggingOperations({ headers })
    const result = await ops.getSecurityAdvisors('test-project')

    expect(result).toHaveLength(1)
    expect((result as Array<{ name: string }>)[0].name).toBe('rls_disabled_in_public')
  })

  it('getPerformanceAdvisors should filter to PERFORMANCE category', async () => {
    const ops = getDebuggingOperations({ headers })
    const result = await ops.getPerformanceAdvisors('test-project')

    expect(result).toHaveLength(1)
    expect((result as Array<{ name: string }>)[0].name).toBe('unindexed_foreign_keys')
  })
})
