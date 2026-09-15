import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMocks } from 'node-mocks-http'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import handler from '../../../../../../../pages/api/platform/storage/[ref]/credentials'

vi.mock('@/lib/constants', () => ({
  IS_PLATFORM: false,
  API_URL: 'https://api.example.com',
}))

describe('/api/platform/storage/[ref]/credentials', () => {
  let stateDir: string
  let configDir: string
  let warnSpy: MockInstance<(...args: unknown[]) => void>

  const envFile = () => readFileSync(join(configDir, 'storage.env'), 'utf8')

  const post = async (body: object) => {
    const { req, res } = createMocks({ method: 'POST', query: { ref: 'default' }, body })
    await handler(req, res)
    return res
  }

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stateDir = mkdtempSync(join(tmpdir(), 'studio-s3-keys-state-'))
    configDir = mkdtempSync(join(tmpdir(), 'studio-s3-keys-env-'))
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
    it.each(['PATCH', 'DELETE', 'PUT'] as const)('should return 405 for %s', async (method) => {
      const { req, res } = createMocks({ method, query: { ref: 'default' } })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(405)
      expect(JSON.parse(res._getData())).toEqual({
        data: null,
        error: { message: `Method ${method} Not Allowed` },
      })
      expect(res.getHeader('Allow')).toEqual(['GET', 'POST'])
    })
  })

  describe('GET', () => {
    it('answers with an empty list when no key has been issued', async () => {
      const { req, res } = createMocks({ method: 'GET', query: { ref: 'default' } })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(200)
      expect(JSON.parse(res._getData())).toEqual({ data: [] })
    })

    it('answers with the key pair from the container environment, and not its secret', async () => {
      vi.stubEnv('S3_PROTOCOL_ACCESS_KEY_ID', 'SBFROMCOMPOSE12345AB')
      vi.stubEnv('S3_PROTOCOL_ACCESS_KEY_SECRET', 'compose-secret')
      const { req, res } = createMocks({ method: 'GET', query: { ref: 'default' } })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(200)
      const body = res._getData()
      expect(JSON.parse(body).data[0]).toMatchObject({
        id: 'env',
        description: 'From container environment',
        access_key: 'SBFROMCOMPOSE12345AB',
      })
      expect(body).not.toContain('compose-secret')
    })
  })

  describe('POST', () => {
    it('answers 200 with the pair, once, and writes it into the env file', async () => {
      const res = await post({ description: 'production' })

      expect(res._getStatusCode()).toBe(200)
      const created = JSON.parse(res._getData())
      expect(created.access_key).toMatch(/^SB[A-Z0-9]{18}$/)
      expect(created.secret_key).toMatch(/^[A-Za-z0-9_-]{40}$/)
      expect(created.description).toBe('production')
      expect(envFile()).toContain(`S3_PROTOCOL_ACCESS_KEY_ID="${created.access_key}"`)
      expect(envFile()).toContain(`S3_PROTOCOL_ACCESS_KEY_SECRET="${created.secret_key}"`)
    })

    it('answers 400 on the second key, because storage holds one', async () => {
      await post({ description: 'production' })

      const res = await post({ description: 'staging' })

      expect(res._getStatusCode()).toBe(400)
      expect(JSON.parse(res._getData()).error.message).toBe(
        'Self-hosted storage supports a single S3 access key; revoke the existing one first'
      )
    })

    it('answers 400 for a description that is not a non-empty string', async () => {
      const res = await post({ description: '' })

      expect(res._getStatusCode()).toBe(400)
      expect(JSON.parse(res._getData()).error.message).toContain('description')
    })

    it('answers 400 for a body that is not an object', async () => {
      const res = await post([])

      expect(res._getStatusCode()).toBe(400)
      expect(JSON.parse(res._getData()).error.message).toContain('object')
    })
  })
})
