import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { COMPUTED_KEYS, DEFAULTS, NULL_BY_DEFAULT, TEMPLATE_IDS } from './defaults'

/**
 * Walks up from the working directory to the repo root. `import.meta.url` is not a file URL under
 * the jsdom environment, and the working directory differs between `pnpm --filter studio` and a
 * run started from the repo root, so neither one alone locates the generated types.
 */
function findPlatformTypes(): string {
  let dir = process.cwd()

  for (let depth = 0; depth < 6; depth++) {
    const candidate = resolve(dir, 'packages/api-types/types/platform.d.ts')
    if (existsSync(candidate)) return candidate
    dir = dirname(dir)
  }

  throw new Error(`packages/api-types/types/platform.d.ts not found above ${process.cwd()}`)
}

const PLATFORM_TYPES = findPlatformTypes()

/**
 * Reads `GoTrueConfigResponse` straight out of the generated types, so this suite fails when the
 * platform type gains a key that neither list here answers for, or changes whether a key may be
 * null. Only properties at the block's own indentation are collected: the nested
 * `*_CUSTOM_CONTENTS` objects repeat names that also exist at the top level with different types.
 */
function collectGoTrueConfigProperties(): Map<string, { nullable: boolean }> {
  const lines = readFileSync(PLATFORM_TYPES, 'utf8').split('\n')

  const start = lines.findIndex((line) => /^\s+GoTrueConfigResponse: \{$/.test(line))
  if (start === -1) throw new Error(`GoTrueConfigResponse not found in ${PLATFORM_TYPES}`)

  const blockIndent = lines[start].search(/\S/)
  const closing = new RegExp(`^${' '.repeat(blockIndent)}\\}$`)

  const properties = new Map<string, { nullable: boolean }>()
  for (let index = start + 1; index < lines.length; index++) {
    if (closing.test(lines[index])) return properties

    const match = lines[index].match(/^(\s+)([A-Z][A-Z0-9_]*)\??: (.+)$/)
    if (match && match[1].length === blockIndent + 2) {
      properties.set(match[2], { nullable: /(^|\|\s*)null\s*$/.test(match[3].trim()) })
    }
  }

  throw new Error(`GoTrueConfigResponse is never closed in ${PLATFORM_TYPES}`)
}

describe('api/self-hosted/auth-config/defaults', () => {
  describe('completeness against GoTrueConfigResponse', () => {
    const properties = collectGoTrueConfigProperties()
    const keys = [...properties.keys()]
    const defaultKeys = new Set(Object.keys(DEFAULTS))
    const nullKeys = new Set<string>(NULL_BY_DEFAULT)

    it('finds the platform type to check against', () => {
      expect(keys.length).toBeGreaterThan(200)
    })

    it('reads nullability off the property lines', () => {
      // Guards the parser itself: if this stopped seeing `| null`, the assertion below would pass
      // vacuously for every key.
      expect([...properties].filter(([, meta]) => meta.nullable).map(([key]) => key)).toContain(
        'WEBAUTHN_RP_ID'
      )
      expect(properties.get('SITE_URL')).toEqual({ nullable: false })
    })

    it('answers for every key, either with a default or with null', () => {
      expect(keys.filter((key) => !defaultKeys.has(key) && !nullKeys.has(key))).toEqual([])
    })

    it('never lists a key in both DEFAULTS and NULL_BY_DEFAULT', () => {
      expect(keys.filter((key) => defaultKeys.has(key) && nullKeys.has(key))).toEqual([])
    })

    it('lists no key that the platform type does not have', () => {
      const known = new Set(keys)

      expect([...defaultKeys, ...nullKeys].filter((key) => !known.has(key))).toEqual([])
    })

    it('answers with null only where the type declares the key nullable', () => {
      // A `null` for a key typed `string` would be a lie the client cannot see coming.
      expect(NULL_BY_DEFAULT.filter((key) => properties.get(key)?.nullable !== true)).toEqual([])
    })
  })

  describe('GoTrue default values', () => {
    // Every value below is a `default:` struct tag or an `ApplyDefaults` fallback in GoTrue's
    // `internal/conf/configuration.go`.
    it.each([
      ['JWT_EXP', 3600],
      ['MAILER_OTP_EXP', 86400],
      ['MAILER_OTP_LENGTH', 6],
      ['SMS_OTP_EXP', 60],
      ['SMS_OTP_LENGTH', 6],
      ['PASSWORD_MIN_LENGTH', 6],
      ['SMTP_PORT', '587'],
      ['SMTP_MAX_FREQUENCY', 60],
      ['RATE_LIMIT_EMAIL_SENT', 30],
      ['RATE_LIMIT_SMS_SENT', 30],
      ['RATE_LIMIT_VERIFY', 30],
      ['RATE_LIMIT_TOKEN_REFRESH', 150],
      ['RATE_LIMIT_ANONYMOUS_USERS', 30],
      ['RATE_LIMIT_OTP', 30],
      ['MFA_TOTP_ENROLL_ENABLED', true],
      ['MFA_TOTP_VERIFY_ENABLED', true],
      ['MFA_PHONE_ENROLL_ENABLED', false],
      ['MFA_PHONE_VERIFY_ENABLED', false],
      // The platform spells GoTrue's `Security.RefreshTokenRotationEnabled` without the prefix.
      ['REFRESH_TOKEN_ROTATION_ENABLED', true],
      ['SECURITY_CAPTCHA_ENABLED', false],
      ['SECURITY_CAPTCHA_PROVIDER', 'hcaptcha'],
      ['SECURITY_MANUAL_LINKING_ENABLED', false],
      ['EXTERNAL_EMAIL_ENABLED', true],
      ['EXTERNAL_PHONE_ENABLED', false],
      ['EXTERNAL_ANONYMOUS_USERS_ENABLED', false],
      ['MAILER_AUTOCONFIRM', false],
      ['MAILER_SECURE_EMAIL_CHANGE_ENABLED', true],
      ['DISABLE_SIGNUP', false],
      ['CUSTOM_OAUTH_ENABLED', true],
      ['CUSTOM_OAUTH_MAX_PROVIDERS', 0],
      ['OAUTH_SERVER_ENABLED', false],
      ['OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION', false],
      ['PASSKEY_ENABLED', false],
      ['AUDIT_LOG_DISABLE_POSTGRES', false],
      ['API_MAX_REQUEST_DURATION', 10],
      ['DB_MAX_POOL_SIZE', 0],
      ['DB_MAX_POOL_SIZE_UNIT', 'connections'],
      ['MFA_MAX_ENROLLED_FACTORS', 10],
      ['MFA_PHONE_OTP_LENGTH', 6],
      ['MFA_PHONE_MAX_FREQUENCY', 60],
      ['SMS_MAX_FREQUENCY', 60],
      ['PASSWORD_REQUIRED_CHARACTERS', ''],
      ['SECURITY_REFRESH_TOKEN_REUSE_INTERVAL', 0],
    ])('defaults %s to %j', (key, value) => {
      expect(DEFAULTS).toHaveProperty(key, value)
    })

    it('disables every external provider by default', () => {
      const enabledFlags = Object.keys(DEFAULTS).filter(
        (key) => key.startsWith('EXTERNAL_') && key.endsWith('_ENABLED')
      )

      // Email is the one provider GoTrue enables out of the box.
      const off = enabledFlags.filter((key) => key !== 'EXTERNAL_EMAIL_ENABLED')
      expect(off.length).toBeGreaterThan(20)
      for (const key of off) expect(DEFAULTS).toHaveProperty(key, false)
    })

    it('disables every auth hook by default', () => {
      const hooks = Object.keys(DEFAULTS).filter(
        (key) => key.startsWith('HOOK_') && key.endsWith('_ENABLED')
      )

      expect(hooks.length).toBeGreaterThan(5)
      for (const key of hooks) expect(DEFAULTS).toHaveProperty(key, false)
    })

    it('reports the session limits as 0, the platform\'s own way of spelling "no limit"', () => {
      // Both are `*time.Duration` in GoTrue, where nil means "no limit"; GoTrue never reads a `0`
      // as disabled, and would take one as a limit of zero. The response type declares them
      // `number`, not `number | null`, so 0 carries the meaning here and `mapping.ts` omits the key
      // rather than writing it, which leaves GoTrue on its nil default.
      expect(DEFAULTS).toHaveProperty('SESSIONS_TIMEBOX', 0)
      expect(DEFAULTS).toHaveProperty('SESSIONS_INACTIVITY_TIMEOUT', 0)
    })

    it('reports unset strings as empty, not null', () => {
      for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_ADMIN_EMAIL', 'SITE_URL']) {
        expect(DEFAULTS).toHaveProperty(key, '')
        expect(NULL_BY_DEFAULT).not.toContain(key)
      }
    })

    it('reserves null for the six keys the type declares nullable with no GoTrue default', () => {
      expect([...NULL_BY_DEFAULT]).toEqual([
        'NIMBUS_OAUTH_CLIENT_ID',
        'NIMBUS_OAUTH_CLIENT_SECRET',
        'OAUTH_SERVER_AUTHORIZATION_PATH',
        'WEBAUTHN_RP_DISPLAY_NAME',
        'WEBAUTHN_RP_ID',
        'WEBAUTHN_RP_ORIGINS',
      ])
    })
  })

  describe('email templates', () => {
    it('lists the 13 templates the Auth UI edits', () => {
      expect(TEMPLATE_IDS).toHaveLength(13)
      expect(new Set(TEMPLATE_IDS).size).toBe(13)
    })

    it('marks every subject as not customised by default', () => {
      const subjects = DEFAULTS.MAILER_SUBJECTS_CUSTOM_CONTENTS
      if (subjects === undefined) throw new Error('MAILER_SUBJECTS_CUSTOM_CONTENTS has no default')

      expect(Object.keys(subjects).sort()).toEqual(
        TEMPLATE_IDS.map((id) => `MAILER_SUBJECTS_${id}`).sort()
      )
      expect(Object.values(subjects).every((value) => value === false)).toBe(true)
    })

    it('marks every template body as not customised by default', () => {
      const templates = DEFAULTS.MAILER_TEMPLATES_CUSTOM_CONTENTS
      if (templates === undefined)
        throw new Error('MAILER_TEMPLATES_CUSTOM_CONTENTS has no default')

      expect(Object.keys(templates).sort()).toEqual(
        TEMPLATE_IDS.map((id) => `MAILER_TEMPLATES_${id}_CONTENT`).sort()
      )
      expect(Object.values(templates).every((value) => value === false)).toBe(true)
    })

    it('gives every computed key a complete default shape', () => {
      for (const key of COMPUTED_KEYS) expect(DEFAULTS).toHaveProperty(key)
    })
  })

  describe('immutability', () => {
    // DEFAULTS is module state shared by every request. A handler that built its response by
    // mutating it in place would change what the next request sees, in a process that stays up for
    // days. Freezing turns that into a throw at the point of the mistake.
    it('refuses a top-level mutation', () => {
      const escaped = DEFAULTS as unknown as Record<string, unknown>

      expect(() => {
        escaped.JWT_EXP = 1
      }).toThrow(TypeError)
      expect(DEFAULTS.JWT_EXP).toBe(3600)
    })

    it('refuses a mutation inside the nested custom-contents objects', () => {
      const subjects = DEFAULTS.MAILER_SUBJECTS_CUSTOM_CONTENTS
      if (subjects === undefined) throw new Error('MAILER_SUBJECTS_CUSTOM_CONTENTS has no default')
      const escaped = subjects as unknown as Record<string, unknown>

      expect(() => {
        escaped.MAILER_SUBJECTS_INVITE = true
      }).toThrow(TypeError)
      expect(subjects.MAILER_SUBJECTS_INVITE).toBe(false)
    })

    it('refuses to grow NULL_BY_DEFAULT', () => {
      const escaped = NULL_BY_DEFAULT as unknown as string[]

      expect(() => escaped.push('SITE_URL')).toThrow(TypeError)
      expect(NULL_BY_DEFAULT).toHaveLength(6)
    })

    it('hands a fresh import the untouched values', async () => {
      const escaped = DEFAULTS as unknown as Record<string, unknown>
      expect(() => {
        escaped.SITE_URL = 'http://leaked'
      }).toThrow(TypeError)

      const reimported = await import('./defaults')

      expect(reimported.DEFAULTS.SITE_URL).toBe('')
      expect(reimported.DEFAULTS.MAILER_SUBJECTS_CUSTOM_CONTENTS).toEqual(
        DEFAULTS.MAILER_SUBJECTS_CUSTOM_CONTENTS
      )
    })
  })
})
