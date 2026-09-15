import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMocks } from 'node-mocks-http'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import handler from '../../../../../../../pages/api/platform/projects/[ref]/config/storage'
import { readJsonState } from '@/lib/api/self-hosted/auth-config/state'

vi.mock('@/lib/constants', () => ({
  IS_PLATFORM: false,
  API_URL: 'https://api.example.com',
}))

describe('/api/platform/projects/[ref]/config/storage', () => {
  let stateDir: string
  let configDir: string
  let warnSpy: MockInstance<(...args: unknown[]) => void>

  const envFile = () => readFileSync(join(configDir, 'storage.env'), 'utf8')

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stateDir = mkdtempSync(join(tmpdir(), 'studio-storage-handler-state-'))
    configDir = mkdtempSync(join(tmpdir(), 'studio-storage-handler-env-'))
    vi.unstubAllEnvs()
    vi.stubEnv('STUDIO_AUTH_STATE_DIR', stateDir)
    vi.stubEnv('STORAGE_CONFIG_DIR', configDir)
    vi.stubEnv('UPLOAD_FILE_SIZE_LIMIT', undefined)
    vi.stubEnv('ENABLE_IMAGE_TRANSFORMATION', undefined)
    vi.stubEnv('S3_PROTOCOL_ENABLED', undefined)
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
    it.each(['POST', 'DELETE', 'PUT'] as const)('should return 405 for %s', async (method) => {
      const { req, res } = createMocks({ method, query: { ref: 'default' } })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(405)
      expect(JSON.parse(res._getData())).toEqual({
        data: null,
        error: { message: `Method ${method} Not Allowed` },
      })
      expect(res.getHeader('Allow')).toEqual(['GET', 'PATCH'])
    })
  })

  describe('GET', () => {
    it('answers with the storage config the container environment is running', async () => {
      vi.stubEnv('UPLOAD_FILE_SIZE_LIMIT', '104857600')
      vi.stubEnv('ENABLE_IMAGE_TRANSFORMATION', 'true')
      const { req, res } = createMocks({ method: 'GET', query: { ref: 'default' } })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(200)
      expect(JSON.parse(res._getData())).toEqual({
        capabilities: { iceberg_catalog: false, list_v2: false, object_versioning: false },
        external: { upstreamTarget: 'main' },
        features: {
          icebergCatalog: { enabled: false, maxCatalogs: 0, maxNamespaces: 0, maxTables: 0 },
          imageTransformation: { enabled: true },
          purgeCache: { enabled: false },
          s3Protocol: { enabled: true },
          vectorBuckets: { enabled: false, maxBuckets: 0, maxIndexes: 0 },
        },
        fileSizeLimit: 104857600,
        migrationVersion: null,
      })
    })

    it('writes nothing', async () => {
      const { req, res } = createMocks({ method: 'GET', query: { ref: 'default' } })

      await handler(req, res)

      expect(await readJsonState('storage-config.json', stateDir)).toEqual({})
      expect(() => envFile()).toThrow()
    })
  })

  describe('PATCH', () => {
    it('answers 200 with the new config and renders the env file', async () => {
      const { req, res } = createMocks({
        method: 'PATCH',
        query: { ref: 'default' },
        body: {
          fileSizeLimit: 104857600,
          features: { imageTransformation: { enabled: true }, s3Protocol: { enabled: false } },
        },
      })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(200)
      expect(JSON.parse(res._getData())).toMatchObject({
        fileSizeLimit: 104857600,
        features: { imageTransformation: { enabled: true }, s3Protocol: { enabled: false } },
      })
      expect(envFile()).toContain('UPLOAD_FILE_SIZE_LIMIT="104857600"')
      expect(envFile()).toContain('S3_PROTOCOL_ENABLED="false"')
    })

    it('answers 400 for a limit storage should not be given', async () => {
      const { req, res } = createMocks({
        method: 'PATCH',
        query: { ref: 'default' },
        body: { fileSizeLimit: 0 },
      })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(400)
      expect(JSON.parse(res._getData()).error.message).toContain('fileSizeLimit')
      expect(() => envFile()).toThrow()
    })

    it('answers 400 for a key that is not a storage setting', async () => {
      const { req, res } = createMocks({
        method: 'PATCH',
        query: { ref: 'default' },
        body: { tenantId: 'other' },
      })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(400)
      expect(JSON.parse(res._getData()).error.message).toContain('tenantId')
    })

    it('answers 400 for a body that is not an object', async () => {
      const { req, res } = createMocks({ method: 'PATCH', query: { ref: 'default' }, body: [] })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(400)
      expect(JSON.parse(res._getData()).error.message).toContain('object')
    })
  })
})
