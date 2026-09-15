import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULTS, NULL_BY_DEFAULT } from './defaults'
import {
  AuthConfigValidationError,
  getAuthConfig,
  MIRRORED_ENV_KEYS,
  resetTemplate,
  updateAuthConfig,
} from './index'
import { MANAGED_KEYS } from './mapping'
import { ENV_FILE_NAME } from './render'
import { AuthConfigState, STATE_FILE_NAME } from './state'

/**
 * Walks up from the working directory to Studio's own `turbo.jsonc`. `import.meta.url` is not a
 * file URL under the jsdom environment, and the working directory differs between a run started by
 * `pnpm --filter studio` and one started from the repo root.
 */
function findStudioTurboConfig(): string {
  let dir = process.cwd()

  for (let depth = 0; depth < 6; depth++) {
    const candidate = resolve(dir, 'apps/studio/turbo.jsonc')
    if (existsSync(candidate)) return candidate
    dir = dirname(dir)
  }

  throw new Error(`apps/studio/turbo.jsonc not found above ${process.cwd()}`)
}

describe('api/self-hosted/auth-config/index', () => {
  let stateDir: string
  let configDir: string

  const readEnvFile = () => readFileSync(join(configDir, ENV_FILE_NAME), 'utf8')
  const readStateFile = (): AuthConfigState =>
    JSON.parse(readFileSync(join(stateDir, STATE_FILE_NAME), 'utf8'))
  const seedState = (state: AuthConfigState) =>
    writeFileSync(join(stateDir, STATE_FILE_NAME), JSON.stringify(state))

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'studio-auth-state-'))
    configDir = mkdtempSync(join(tmpdir(), 'studio-gotrue-config-'))

    vi.stubEnv('STUDIO_AUTH_STATE_DIR', stateDir)
    vi.stubEnv('GOTRUE_CONFIG_DIR', configDir)
    // The suite runs in one process, so a mirrored value left by another test would leak in here.
    for (const name of MIRRORED_ENV_KEYS) vi.stubEnv(name, '')
  })

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true })
    rmSync(configDir, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  describe('getAuthConfig', () => {
    it('answers for every key of the platform contract', async () => {
      const config = await getAuthConfig()
      const expected = [...Object.keys(DEFAULTS), ...NULL_BY_DEFAULT].sort()

      expect(Object.keys(config).sort()).toEqual(expected)
    })

    it('falls back to the recorded defaults when nothing is set', async () => {
      const config = await getAuthConfig()

      expect(config.SITE_URL).toBe('')
      expect(config.JWT_EXP).toBe(DEFAULTS.JWT_EXP)
      expect(config.MAILER_AUTOCONFIRM).toBe(false)
      expect(config.SMTP_PORT).toBe('587')
    })

    it('answers null for the keys the response type declares nullable', async () => {
      const config = await getAuthConfig()

      expect(config.WEBAUTHN_RP_ID).toBeNull()
      expect(config.NIMBUS_OAUTH_CLIENT_ID).toBeNull()
    })

    it('reads a mirrored env value in place of the default', async () => {
      vi.stubEnv('GOTRUE_SITE_URL', 'https://mirrored.test')

      expect((await getAuthConfig()).SITE_URL).toBe('https://mirrored.test')
    })

    it('parses a mirrored value to the type the key is declared with', async () => {
      vi.stubEnv('GOTRUE_JWT_EXP', '7200')
      vi.stubEnv('GOTRUE_MAILER_AUTOCONFIRM', 'true')
      vi.stubEnv('GOTRUE_SMTP_PORT', '2500')

      const config = await getAuthConfig()

      expect(config.JWT_EXP).toBe(7200)
      expect(config.MAILER_AUTOCONFIRM).toBe(true)
      // The platform types the port as a string even though GoTrue's own field is an int.
      expect(config.SMTP_PORT).toBe('2500')
    })

    it('ignores a mirrored value that cannot stand for its key', async () => {
      vi.stubEnv('GOTRUE_JWT_EXP', 'not-a-number')
      vi.stubEnv('GOTRUE_MAILER_AUTOCONFIRM', 'sometimes')

      const config = await getAuthConfig()

      expect(config.JWT_EXP).toBe(DEFAULTS.JWT_EXP)
      expect(config.MAILER_AUTOCONFIRM).toBe(false)
    })

    it('prefers the saved state over the mirrored env', async () => {
      vi.stubEnv('GOTRUE_SITE_URL', 'https://mirrored.test')
      seedState({ SITE_URL: 'https://saved.test' })

      expect((await getAuthConfig()).SITE_URL).toBe('https://saved.test')
    })

    it('reports a template as customised only where the state holds a body for it', async () => {
      seedState({
        MAILER_TEMPLATES_MAGIC_LINK_CONTENT: '<p>hi</p>',
        MAILER_TEMPLATES_INVITE_CONTENT: '',
        MAILER_SUBJECTS_RECOVERY: 'Reset it',
      })

      const config = await getAuthConfig()

      expect(config.MAILER_TEMPLATES_CUSTOM_CONTENTS.MAILER_TEMPLATES_MAGIC_LINK_CONTENT).toBe(true)
      expect(config.MAILER_TEMPLATES_CUSTOM_CONTENTS.MAILER_TEMPLATES_INVITE_CONTENT).toBe(false)
      expect(config.MAILER_SUBJECTS_CUSTOM_CONTENTS.MAILER_SUBJECTS_RECOVERY).toBe(true)
      expect(config.MAILER_SUBJECTS_CUSTOM_CONTENTS.MAILER_SUBJECTS_INVITE).toBe(false)
    })

    it('never answers the oauth provider quota from the state', async () => {
      seedState({ CUSTOM_OAUTH_MAX_PROVIDERS: 12 })

      expect((await getAuthConfig()).CUSTOM_OAUTH_MAX_PROVIDERS).toBe(0)
    })

    it('mirrors only keys whose GoTrue name is the key itself', async () => {
      const unmanaged = MIRRORED_ENV_KEYS.map((name) => name.slice('GOTRUE_'.length)).filter(
        (key) => !MANAGED_KEYS.has(key)
      )

      expect(unmanaged).toEqual([])
    })

    it('has every mirrored name declared in turbo.jsonc', () => {
      // Turborepo strips any env var the build task does not list, so a name missing there reads
      // as unset in the built image and the mirrored value silently disappears.
      const turbo = readFileSync(findStudioTurboConfig(), 'utf8')

      expect(MIRRORED_ENV_KEYS.filter((name) => !turbo.includes(`"${name}"`))).toEqual([])
      expect(turbo).toContain('"STUDIO_INTERNAL_URL"')
    })
  })

  describe('updateAuthConfig', () => {
    it('records the patch and renders it into the file GoTrue watches', async () => {
      const config = await updateAuthConfig({ SITE_URL: 'https://x.test' })

      expect(config.SITE_URL).toBe('https://x.test')
      expect(readStateFile()).toEqual({ SITE_URL: 'https://x.test' })
      expect(readEnvFile()).toContain('GOTRUE_SITE_URL="https://x.test"')
    })

    it('writes neither file when the patch is refused', async () => {
      await updateAuthConfig({ SITE_URL: 'https://x.test' })
      const stateBefore = readStateFile()
      const envBefore = readEnvFile()

      await expect(
        updateAuthConfig({ URI_ALLOW_LIST: 'https://a.test/[unbalanced' })
      ).rejects.toBeInstanceOf(AuthConfigValidationError)

      expect(readStateFile()).toEqual(stateBefore)
      expect(readEnvFile()).toBe(envBefore)
    })

    it('reports why the patch was refused', async () => {
      await expect(updateAuthConfig({ JWT_EXP: 'an hour' })).rejects.toThrow(/JWT_EXP/)
    })

    it('drops a key from the state when the patch sends null, so the env answers again', async () => {
      vi.stubEnv('GOTRUE_SITE_URL', 'https://mirrored.test')
      await updateAuthConfig({ SITE_URL: 'https://saved.test' })

      const config = await updateAuthConfig({ SITE_URL: null })

      expect(config.SITE_URL).toBe('https://mirrored.test')
      expect(readStateFile()).toEqual({})
      expect(readEnvFile()).toContain('GOTRUE_SITE_URL="https://mirrored.test"')
    })

    it('ignores an empty SMTP_PASS, which is what the UI sends for a password it never saw', async () => {
      await updateAuthConfig({ SMTP_PASS: 'a-real-password' })

      await updateAuthConfig({ SMTP_PASS: '', SMTP_HOST: 'smtp.test' })

      expect(readStateFile()).toEqual({ SMTP_PASS: 'a-real-password', SMTP_HOST: 'smtp.test' })
    })

    it('accepts a body that round-trips the computed keys back', async () => {
      const config = await getAuthConfig()

      const updated = await updateAuthConfig({
        MAILER_SUBJECTS_CUSTOM_CONTENTS: config.MAILER_SUBJECTS_CUSTOM_CONTENTS,
        MAILER_TEMPLATES_CUSTOM_CONTENTS: config.MAILER_TEMPLATES_CUSTOM_CONTENTS,
        SITE_URL: 'https://round-trip.test',
      })

      expect(updated.SITE_URL).toBe('https://round-trip.test')
      expect(readStateFile()).toEqual({ SITE_URL: 'https://round-trip.test' })
    })

    it('serves a customised template as a URL GoTrue can fetch it from', async () => {
      vi.stubEnv('STUDIO_INTERNAL_URL', 'http://studio.internal:3000')

      await updateAuthConfig({ MAILER_TEMPLATES_MAGIC_LINK_CONTENT: '<p>hi</p>' })

      expect(readEnvFile()).toContain(
        'GOTRUE_MAILER_TEMPLATES_MAGIC_LINK="http://studio.internal:3000/api/platform/auth/default/templates/magic_link/content"'
      )
    })
  })

  describe('resetTemplate', () => {
    it('clears the stored body and subject, and reports the template as no longer customised', async () => {
      await updateAuthConfig({
        MAILER_TEMPLATES_MAGIC_LINK_CONTENT: '<p>hi</p>',
        MAILER_SUBJECTS_MAGIC_LINK: 'Your link',
        SITE_URL: 'https://x.test',
      })

      const config = await resetTemplate('MAGIC_LINK')

      expect(config.MAILER_TEMPLATES_CUSTOM_CONTENTS.MAILER_TEMPLATES_MAGIC_LINK_CONTENT).toBe(
        false
      )
      expect(config.MAILER_SUBJECTS_CUSTOM_CONTENTS.MAILER_SUBJECTS_MAGIC_LINK).toBe(false)
      // Everything else the UI had saved survives.
      expect(readStateFile()).toEqual({ SITE_URL: 'https://x.test' })
      expect(readEnvFile()).toContain('GOTRUE_MAILER_TEMPLATES_MAGIC_LINK=""')
    })

    it('writes the env file even when the template was never customised', async () => {
      expect(existsSync(join(configDir, ENV_FILE_NAME))).toBe(false)

      await resetTemplate('RECOVERY')

      expect(existsSync(join(configDir, ENV_FILE_NAME))).toBe(true)
    })
  })
})
