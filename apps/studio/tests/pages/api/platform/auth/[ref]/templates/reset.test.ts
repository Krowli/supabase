import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMocks } from 'node-mocks-http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import handler from '../../../../../../../pages/api/platform/auth/[ref]/templates/[template]/reset'
import { updateAuthConfig } from '@/lib/api/self-hosted/auth-config'
import { mswServer } from '@/tests/lib/msw'

vi.mock('@/lib/constants', () => ({
  IS_PLATFORM: false,
  API_URL: 'https://api.example.com',
}))

const ENV_FILE = '99_studio.env'

describe('/api/platform/auth/[ref]/templates/[template]/reset', () => {
  let stateDir: string
  let configDir: string

  const envFilePath = () => join(configDir, ENV_FILE)

  const customiseMagicLink = () =>
    updateAuthConfig({
      MAILER_SUBJECTS_MAGIC_LINK: 'Your link',
      MAILER_TEMPLATES_MAGIC_LINK_CONTENT: '<h1>{{ .Token }}</h1>',
    })

  beforeEach(() => {
    // The handler does not hit the network; disable MSW so unrelated unhandled-request errors don't fire.
    mswServer.close()
    vi.unstubAllEnvs()

    stateDir = mkdtempSync(join(tmpdir(), 'studio-auth-state-'))
    configDir = mkdtempSync(join(tmpdir(), 'studio-gotrue-config-'))
    vi.stubEnv('STUDIO_AUTH_STATE_DIR', stateDir)
    vi.stubEnv('GOTRUE_CONFIG_DIR', configDir)
    // A mirrored subject, cleared so a GoTrue variable in the ambient environment cannot stand in
    // for the one this file resets.
    vi.stubEnv('GOTRUE_MAILER_SUBJECTS_MAGIC_LINK', '')
  })

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true })
    rmSync(configDir, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  describe('Method handling', () => {
    it.each(['GET', 'PATCH', 'DELETE'] as const)('should return 405 for %s', async (method) => {
      const { req, res } = createMocks({
        method,
        query: { ref: 'default', template: 'magic-link' },
      })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(405)
      expect(JSON.parse(res._getData())).toEqual({
        data: null,
        error: { message: `Method ${method} Not Allowed` },
      })
      expect(res.getHeader('Allow')).toEqual(['POST'])
    })
  })

  describe('POST', () => {
    it('drops the saved subject and body, and tells GoTrue to use its own template again', async () => {
      await customiseMagicLink()
      expect(readFileSync(envFilePath(), 'utf8')).toContain(
        'GOTRUE_MAILER_TEMPLATES_MAGIC_LINK="http://supabase-studio:3000/api/platform/auth/default/templates/magic_link/content"'
      )

      // Lower kebab case is what the client sends: `ResetTemplateDialog` passes the id through
      // `getAuthTemplateType`, which lowercases it and swaps `_` for `-`.
      const { req, res } = createMocks({
        method: 'POST',
        query: { ref: 'default', template: 'magic-link' },
      })
      await handler(req, res)

      expect(res._getStatusCode()).toBe(200)
      const data = JSON.parse(res._getData())
      expect(data.MAILER_TEMPLATES_CUSTOM_CONTENTS.MAILER_TEMPLATES_MAGIC_LINK_CONTENT).toBe(false)
      expect(data.MAILER_SUBJECTS_CUSTOM_CONTENTS.MAILER_SUBJECTS_MAGIC_LINK).toBe(false)
      expect(data.MAILER_TEMPLATES_MAGIC_LINK_CONTENT).toBe('')
      expect(data.MAILER_SUBJECTS_MAGIC_LINK).toBe('')

      // An empty value, not a missing line: GoTrue keys are sticky, so dropping the line would
      // leave the old URL in force.
      expect(readFileSync(envFilePath(), 'utf8')).toContain('GOTRUE_MAILER_TEMPLATES_MAGIC_LINK=""')
    })

    it('leaves every other template alone', async () => {
      await customiseMagicLink()
      await updateAuthConfig({ MAILER_TEMPLATES_RECOVERY_CONTENT: '<p>recover</p>' })

      const { req, res } = createMocks({
        method: 'POST',
        query: { ref: 'default', template: 'magic-link' },
      })
      await handler(req, res)

      expect(res._getStatusCode()).toBe(200)
      const data = JSON.parse(res._getData())
      expect(data.MAILER_TEMPLATES_RECOVERY_CONTENT).toBe('<p>recover</p>')
      expect(data.MAILER_TEMPLATES_CUSTOM_CONTENTS.MAILER_TEMPLATES_RECOVERY_CONTENT).toBe(true)
    })

    it.each(['magic-link', 'MAGIC-LINK', 'magic_link'])(
      'accepts the id spelled %s',
      async (template) => {
        await customiseMagicLink()

        const { req, res } = createMocks({
          method: 'POST',
          query: { ref: 'default', template },
        })
        await handler(req, res)

        expect(res._getStatusCode()).toBe(200)
        expect(
          JSON.parse(res._getData()).MAILER_TEMPLATES_CUSTOM_CONTENTS
            .MAILER_TEMPLATES_MAGIC_LINK_CONTENT
        ).toBe(false)
      }
    )

    it('answers 404 for an id that is not a template, without writing anything', async () => {
      await customiseMagicLink()
      const envBefore = readFileSync(envFilePath(), 'utf8')

      const { req, res } = createMocks({
        method: 'POST',
        query: { ref: 'default', template: 'not-a-template' },
      })
      await handler(req, res)

      expect(res._getStatusCode()).toBe(404)
      expect(JSON.parse(res._getData()).error.message).toBe('Unknown template')
      expect(readFileSync(envFilePath(), 'utf8')).toBe(envBefore)
    })
  })
})
