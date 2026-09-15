import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMocks } from 'node-mocks-http'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import handler from '../../../../../../../pages/api/platform/storage/[ref]/credentials/[id]'
import { createCredential } from '@/lib/api/self-hosted/service-config/storage'

vi.mock('@/lib/constants', () => ({
  IS_PLATFORM: false,
  API_URL: 'https://api.example.com',
}))

describe('/api/platform/storage/[ref]/credentials/[id]', () => {
  let stateDir: string
  let configDir: string
  let warnSpy: MockInstance<(...args: unknown[]) => void>

  const envFile = () => readFileSync(join(configDir, 'storage.env'), 'utf8')

  const del = async (id: string) => {
    const { req, res } = createMocks({ method: 'DELETE', query: { ref: 'default', id } })
    await handler(req, res)
    return res
  }

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stateDir = mkdtempSync(join(tmpdir(), 'studio-s3-revoke-state-'))
    configDir = mkdtempSync(join(tmpdir(), 'studio-s3-revoke-env-'))
    vi.unstubAllEnvs()
    vi.stubEnv('STUDIO_AUTH_STATE_DIR', stateDir)
    vi.stubEnv('STORAGE_CONFIG_DIR', configDir)
    vi.stubEnv('S3_PROTOCOL_ACCESS_KEY_ID', undefined)
    vi.stubEnv('S3_PROTOCOL_ACCESS_KEY_SECRET', undefined)
  })

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true })
    rmSync(configDir, { recursive: true, force: true })
    warnSpy.mockRestore()
    vi.unstubAllEnvs()
  })

  describe('Method handling', () => {
    it.each(['GET', 'POST', 'PATCH'] as const)('should return 405 for %s', async (method) => {
      const { req, res } = createMocks({ method, query: { ref: 'default', id: 'env' } })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(405)
      expect(JSON.parse(res._getData())).toEqual({
        data: null,
        error: { message: `Method ${method} Not Allowed` },
      })
      expect(res.getHeader('Allow')).toEqual(['DELETE'])
    })
  })

  describe('DELETE', () => {
    it('answers 204 with no body and empties the pair in the env file', async () => {
      const created = await createCredential('production')

      const res = await del(created.id)

      expect(res._getStatusCode()).toBe(204)
      expect(res._getData()).toBe('')
      expect(envFile()).toContain('S3_PROTOCOL_ACCESS_KEY_ID=""')
      expect(envFile()).toContain('S3_PROTOCOL_ACCESS_KEY_SECRET=""')
    })

    it('answers 404 for an id that is not the live key', async () => {
      await createCredential('production')

      const res = await del('00000000-0000-4000-8000-000000000000')

      expect(res._getStatusCode()).toBe(404)
      expect(JSON.parse(res._getData()).error.message).toContain(
        '00000000-0000-4000-8000-000000000000'
      )
    })

    it('answers 404 when there is nothing to revoke', async () => {
      const res = await del('env')

      expect(res._getStatusCode()).toBe(404)
    })

    it('answers 400 when no id reaches the route', async () => {
      const { req, res } = createMocks({ method: 'DELETE', query: { ref: 'default' } })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(400)
      expect(JSON.parse(res._getData()).error.message).toContain('id')
    })
  })
})
