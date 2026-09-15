import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { components } from 'api-types'
import { createMocks } from 'node-mocks-http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import handler from '../../../../../../../pages/api/platform/auth/[ref]/config/hooks'
import { mswServer } from '@/tests/lib/msw'

vi.mock('@/lib/constants', () => ({
  IS_PLATFORM: false,
  API_URL: 'https://api.example.com',
}))

const ENV_FILE = '99_studio.env'

describe('/api/platform/auth/[ref]/config/hooks', () => {
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
  })

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true })
    rmSync(configDir, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  describe('Method handling', () => {
    it.each(['GET', 'POST', 'DELETE'] as const)('should return 405 for %s', async (method) => {
      const { req, res } = createMocks({ method, query: { ref: 'default' } })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(405)
      expect(JSON.parse(res._getData())).toEqual({
        data: null,
        error: { message: `Method ${method} Not Allowed` },
      })
      expect(res.getHeader('Allow')).toEqual(['PATCH'])
    })
  })

  describe('PATCH', () => {
    it('saves a hook and renders it into the file GoTrue watches', async () => {
      const body: components['schemas']['UpdateGoTrueConfigHooksBody'] = {
        HOOK_SEND_EMAIL_URI: 'pg-functions://postgres/public/send_email',
        HOOK_SEND_EMAIL_ENABLED: true,
      }
      const { req, res } = createMocks({ method: 'PATCH', query: { ref: 'default' }, body })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(200)
      const data = JSON.parse(res._getData())
      expect(data.HOOK_SEND_EMAIL_URI).toBe('pg-functions://postgres/public/send_email')
      expect(data.HOOK_SEND_EMAIL_ENABLED).toBe(true)

      const env = readFileSync(envFilePath(), 'utf8')
      expect(env).toContain(
        'GOTRUE_HOOK_SEND_EMAIL_URI="pg-functions://postgres/public/send_email"'
      )
      expect(env).toContain('GOTRUE_HOOK_SEND_EMAIL_ENABLED="true"')
    })

    it('refuses a key that is not a hook setting, and writes nothing', async () => {
      const { req, res } = createMocks({
        method: 'PATCH',
        query: { ref: 'default' },
        body: { HOOK_SEND_EMAIL_ENABLED: true, SITE_URL: 'https://x.test' },
      })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(400)
      expect(JSON.parse(res._getData()).error.message).toBe('Not an auth hook setting: SITE_URL')
      expect(existsSync(envFilePath())).toBe(false)
    })

    it('refuses a hook URI GoTrue could not reach', async () => {
      const { req, res } = createMocks({
        method: 'PATCH',
        query: { ref: 'default' },
        body: { HOOK_SEND_EMAIL_URI: 'pg-functions://postgres/public' },
      })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(400)
      expect(JSON.parse(res._getData()).error.message).toMatch(/HOOK_SEND_EMAIL_URI/)
      expect(existsSync(envFilePath())).toBe(false)
    })

    it('refuses a body that is not an object', async () => {
      const { req, res } = createMocks({ method: 'PATCH', query: { ref: 'default' }, body: [] })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(400)
      expect(JSON.parse(res._getData()).error.message).toBe(
        'Body must be an object of hook settings'
      )
    })
  })
})
