import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { components } from 'api-types'
import { createMocks } from 'node-mocks-http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import handler from '../../../../../../pages/api/platform/auth/[ref]/config'
import { mswServer } from '@/tests/lib/msw'

vi.mock('@/lib/constants', () => ({
  IS_PLATFORM: false,
  API_URL: 'https://api.example.com',
}))

const ENV_FILE = '99_studio.env'
const STATE_FILE = 'auth-config.json'

describe('/api/platform/auth/[ref]/config', () => {
  let stateDir: string
  let configDir: string

  const envFilePath = () => join(configDir, ENV_FILE)

  beforeEach(() => {
    // The handler does not hit the network; disable MSW so unrelated unhandled-request errors don't fire.
    mswServer.close()
    vi.unstubAllEnvs()

    stateDir = mkdtempSync(join(tmpdir(), 'studio-auth-state-'))
    configDir = mkdtempSync(join(tmpdir(), 'studio-gotrue-config-'))
    vi.stubEnv('STUDIO_AUTH_STATE_DIR', stateDir)
    vi.stubEnv('GOTRUE_CONFIG_DIR', configDir)
    // The two mirrored settings this file asserts on, cleared so a GoTrue variable in the ambient
    // environment cannot decide the answer.
    vi.stubEnv('GOTRUE_SITE_URL', '')
    vi.stubEnv('GOTRUE_DISABLE_SIGNUP', '')
  })

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true })
    rmSync(configDir, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  describe('Method handling', () => {
    it.each(['POST', 'DELETE'])('should return 405 for %s', async (method) => {
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
    it('returns the config, with the mirrored GoTrue env in it', async () => {
      vi.stubEnv('GOTRUE_SITE_URL', 'https://mirrored.test')

      const { req, res } = createMocks({ method: 'GET', query: { ref: 'default' } })
      await handler(req, res)

      expect(res._getStatusCode()).toBe(200)
      const data = JSON.parse(res._getData())
      expect(data.SITE_URL).toBe('https://mirrored.test')
      expect(data.DISABLE_SIGNUP).toBe(false)
    })

    it('writes nothing', async () => {
      const { req, res } = createMocks({ method: 'GET', query: { ref: 'default' } })
      await handler(req, res)

      expect(existsSync(envFilePath())).toBe(false)
      expect(existsSync(join(stateDir, STATE_FILE))).toBe(false)
    })
  })

  describe('PATCH', () => {
    it('saves the settings and answers with the config as it now stands', async () => {
      const body: components['schemas']['UpdateGoTrueConfigBody'] = {
        SITE_URL: 'https://x.test',
        DISABLE_SIGNUP: true,
      }
      const { req, res } = createMocks({ method: 'PATCH', query: { ref: 'default' }, body })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(200)
      const data = JSON.parse(res._getData())
      expect(data.SITE_URL).toBe('https://x.test')
      expect(data.DISABLE_SIGNUP).toBe(true)

      expect(readFileSync(envFilePath(), 'utf8')).toContain('GOTRUE_SITE_URL="https://x.test"')
      expect(JSON.parse(readFileSync(join(stateDir, STATE_FILE), 'utf8'))).toEqual(body)
    })

    it('refuses a redirect glob GoTrue would panic on, and leaves the env file alone', async () => {
      const { req: first, res: firstRes } = createMocks({
        method: 'PATCH',
        query: { ref: 'default' },
        body: { SITE_URL: 'https://x.test' },
      })
      await handler(first, firstRes)
      const envBefore = readFileSync(envFilePath(), 'utf8')

      const { req, res } = createMocks({
        method: 'PATCH',
        query: { ref: 'default' },
        body: { URI_ALLOW_LIST: 'https://a.test/[unbalanced' },
      })
      await handler(req, res)

      expect(res._getStatusCode()).toBe(400)
      expect(JSON.parse(res._getData()).error.message).toMatch(/URI_ALLOW_LIST/)
      expect(readFileSync(envFilePath(), 'utf8')).toBe(envBefore)
    })

    it('refuses a body that is not an object', async () => {
      const { req, res } = createMocks({ method: 'PATCH', query: { ref: 'default' }, body: 'nope' })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(400)
      expect(JSON.parse(res._getData()).error.message).toBe(
        'Body must be an object of auth settings'
      )
    })
  })
})
