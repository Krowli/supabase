import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMocks } from 'node-mocks-http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import handler from '../../../../../../../pages/api/platform/auth/[ref]/templates/[template]/content'
import { updateAuthConfig } from '@/lib/api/self-hosted/auth-config'
import { mswServer } from '@/tests/lib/msw'

vi.mock('@/lib/constants', () => ({
  IS_PLATFORM: false,
  API_URL: 'https://api.example.com',
}))

const TEMPLATE_HTML = '<h1>{{ .Token }}</h1>'

describe('/api/platform/auth/[ref]/templates/[template]/content', () => {
  let stateDir: string
  let configDir: string

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
    it.each(['POST', 'DELETE'] as const)('should return 405 for %s', async (method) => {
      const { req, res } = createMocks({
        method,
        query: { ref: 'default', template: 'magic_link' },
      })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(405)
      expect(JSON.parse(res._getData())).toEqual({
        data: null,
        error: { message: `Method ${method} Not Allowed` },
      })
      expect(res.getHeader('Allow')).toEqual(['GET'])
    })
  })

  describe('GET', () => {
    it('serves the saved body as HTML, uncached', async () => {
      await updateAuthConfig({ MAILER_TEMPLATES_MAGIC_LINK_CONTENT: TEMPLATE_HTML })

      const { req, res } = createMocks({
        method: 'GET',
        query: { ref: 'default', template: 'magic_link' },
      })
      await handler(req, res)

      expect(res._getStatusCode()).toBe(200)
      expect(res._getData()).toBe(TEMPLATE_HTML)
      expect(res.getHeader('Content-Type')).toBe('text/html; charset=utf-8')
      // The next save changes the answer, and GoTrue re-fetches per email.
      expect(res.getHeader('Cache-Control')).toBe('no-store')
    })

    it('answers 404 for a template nobody has customised', async () => {
      const { req, res } = createMocks({
        method: 'GET',
        query: { ref: 'default', template: 'magic_link' },
      })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(404)
      expect(JSON.parse(res._getData()).error.message).toBe('Template not customised')
    })

    it('answers 404 for an id that is not a template', async () => {
      const { req, res } = createMocks({
        method: 'GET',
        query: { ref: 'default', template: 'not_a_template' },
      })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(404)
      expect(JSON.parse(res._getData()).error.message).toBe('Unknown template')
    })

    it('does not leak one template body under another id', async () => {
      await updateAuthConfig({ MAILER_TEMPLATES_MAGIC_LINK_CONTENT: TEMPLATE_HTML })

      const { req, res } = createMocks({
        method: 'GET',
        query: { ref: 'default', template: 'recovery' },
      })
      await handler(req, res)

      expect(res._getStatusCode()).toBe(404)
      expect(JSON.parse(res._getData()).error.message).toBe('Template not customised')
    })
  })
})
