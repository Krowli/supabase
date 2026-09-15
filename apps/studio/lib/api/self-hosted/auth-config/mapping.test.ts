import { describe, expect, it } from 'vitest'

import { COMPUTED_KEYS, DEFAULTS, TEMPLATE_IDS } from './defaults'
import { MANAGED_KEYS, PlatformConfig, toEnv, UI_ONLY_KEYS, UNMAPPED_KEYS } from './mapping'

const CTX = {
  templateBaseUrl: 'https://studio.example.com/templates',
  apiExternalUrl: 'https://gotrue.example.com',
}

/** Test configs name keys from both the response and the update body, so they are plain records. */
const env = (config: Record<string, unknown>, ctx = CTX) => toEnv(config as PlatformConfig, ctx)

describe('api/self-hosted/auth-config/mapping', () => {
  describe('key sets', () => {
    it('manages every platform key except the computed ones', () => {
      for (const key of COMPUTED_KEYS) expect(MANAGED_KEYS.has(key)).toBe(false)

      expect(MANAGED_KEYS.size).toBe(240)
      expect(MANAGED_KEYS.has('SITE_URL')).toBe(true)
      // Writable but never returned, so it exists only in the update body.
      expect(MANAGED_KEYS.has('EXTERNAL_X_ENABLED')).toBe(true)
    })

    it('manages the UI-only keys too, because a client sends them', () => {
      // `DB_MAX_POOL_SIZE_UNIT` is in `UpdateGoTrueConfigBody`. Refusing it as unknown would make
      // every pool-size change fail. It is barred from the env file, not from a PATCH.
      for (const key of UI_ONLY_KEYS) expect(MANAGED_KEYS.has(key)).toBe(true)
    })

    it('keeps the unmapped keys managed, so they still round-trip through state', () => {
      expect([...UNMAPPED_KEYS].sort()).toEqual([
        'MFA_ALLOW_LOW_AAL',
        'NIMBUS_OAUTH_CLIENT_ID',
        'NIMBUS_OAUTH_CLIENT_SECRET',
      ])
      for (const key of UNMAPPED_KEYS) expect(MANAGED_KEYS.has(key)).toBe(true)
    })
  })

  describe('the default rule', () => {
    it('prefixes the platform key with GOTRUE_', () => {
      expect(env({ SITE_URL: 'https://app.example.com' })).toEqual({
        GOTRUE_SITE_URL: 'https://app.example.com',
      })
    })

    it('writes booleans as true and false', () => {
      expect(env({ MAILER_AUTOCONFIRM: true, DISABLE_SIGNUP: false })).toEqual({
        GOTRUE_MAILER_AUTOCONFIRM: 'true',
        GOTRUE_DISABLE_SIGNUP: 'false',
      })
    })

    it('writes numbers as their decimal text', () => {
      expect(env({ JWT_EXP: 3600, RATE_LIMIT_TOKEN_REFRESH: 150, PASSWORD_MIN_LENGTH: 0 })).toEqual(
        {
          GOTRUE_JWT_EXP: '3600',
          GOTRUE_RATE_LIMIT_TOKEN_REFRESH: '150',
          GOTRUE_PASSWORD_MIN_LENGTH: '0',
        }
      )
    })

    it('leaves the integer-seconds keys as plain numbers', () => {
      // These are `int`/`uint` in GoTrue, not durations. A "3600s" here fails the parse.
      expect(
        env({
          JWT_EXP: 3600,
          MAILER_OTP_EXP: 86400,
          SMS_OTP_EXP: 60,
          SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: 10,
        })
      ).toEqual({
        GOTRUE_JWT_EXP: '3600',
        GOTRUE_MAILER_OTP_EXP: '86400',
        GOTRUE_SMS_OTP_EXP: '60',
        GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: '10',
      })
    })

    it('skips null and undefined', () => {
      expect(env({ SITE_URL: null, SMTP_HOST: undefined, JWT_EXP: null })).toEqual({})
    })

    it('renames the one key whose GoTrue field carries an extra prefix', () => {
      // GoTrue's field is `Security.RefreshTokenRotationEnabled`; the platform key has no
      // `SECURITY_`. Deriving this one mechanically writes a line GoTrue ignores.
      expect(env({ REFRESH_TOKEN_ROTATION_ENABLED: false })).toEqual({
        GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED: 'false',
      })
    })
  })

  describe('empty strings', () => {
    it('writes an empty value for a string-typed GoTrue field', () => {
      // `KEY=""` is the only way to clear a value: GoTrue keeps the last value of a key that
      // disappears from the file.
      expect(
        env({
          SMTP_HOST: '',
          URI_ALLOW_LIST: '',
          PASSWORD_REQUIRED_CHARACTERS: '',
          HOOK_SEND_SMS_SECRETS: '',
          MAILER_SUBJECTS_INVITE: '',
        })
      ).toEqual({
        GOTRUE_SMTP_HOST: '',
        GOTRUE_URI_ALLOW_LIST: '',
        GOTRUE_PASSWORD_REQUIRED_CHARACTERS: '',
        GOTRUE_HOOK_SEND_SMS_SECRETS: '',
        GOTRUE_MAILER_SUBJECTS_INVITE: '',
      })
    })

    it('drops an empty value for a field GoTrue does not parse as text', () => {
      // `.SMTP.Port` is an `int` even though the platform types the key `string`; an empty value
      // there fails the reload of the whole file.
      expect(env({ SMTP_PORT: '', SMS_TEST_OTP: '', SMS_TEST_OTP_VALID_UNTIL: '' })).toEqual({})
    })

    it('still writes a non-empty value for those keys', () => {
      expect(env({ SMTP_PORT: '2525' })).toEqual({ GOTRUE_SMTP_PORT: '2525' })
    })
  })

  describe('durations', () => {
    it('turns the seconds-valued keys into Go duration strings', () => {
      expect(
        env({
          SMTP_MAX_FREQUENCY: 60,
          API_MAX_REQUEST_DURATION: 10,
          MFA_PHONE_MAX_FREQUENCY: 30,
          SMS_MAX_FREQUENCY: 45,
        })
      ).toEqual({
        GOTRUE_SMTP_MAX_FREQUENCY: '60s',
        GOTRUE_API_MAX_REQUEST_DURATION: '10s',
        GOTRUE_MFA_PHONE_MAX_FREQUENCY: '30s',
        GOTRUE_SMS_MAX_FREQUENCY: '45s',
      })
    })

    it('turns the session limits into hours', () => {
      expect(env({ SESSIONS_TIMEBOX: 24, SESSIONS_INACTIVITY_TIMEOUT: 8 })).toEqual({
        GOTRUE_SESSIONS_TIMEBOX: '24h',
        GOTRUE_SESSIONS_INACTIVITY_TIMEOUT: '8h',
      })
    })

    it('omits a session limit of 0 rather than writing "0"', () => {
      // Both are `*time.Duration`: nil means no limit, and "0h" would be a limit of zero, which
      // expires every session immediately.
      expect(env({ SESSIONS_TIMEBOX: 0, SESSIONS_INACTIVITY_TIMEOUT: 0 })).toEqual({})
    })

    it('writes a zero for the seconds-valued keys, where zero is a real setting', () => {
      expect(env({ SMTP_MAX_FREQUENCY: 0 })).toEqual({ GOTRUE_SMTP_MAX_FREQUENCY: '0s' })
    })
  })

  describe('email templates', () => {
    it('writes the URL Studio serves the body at, never the body', () => {
      expect(env({ MAILER_TEMPLATES_CONFIRMATION_CONTENT: '<p>Confirm</p>' })).toEqual({
        GOTRUE_MAILER_TEMPLATES_CONFIRMATION:
          'https://studio.example.com/templates/confirmation/content',
      })
    })

    it('writes an empty URL for a body the UI cleared, which restores the built-in template', () => {
      expect(env({ MAILER_TEMPLATES_MAGIC_LINK_CONTENT: '' })).toEqual({
        GOTRUE_MAILER_TEMPLATES_MAGIC_LINK: '',
      })
    })

    it('covers all thirteen templates', () => {
      const config = Object.fromEntries(
        TEMPLATE_IDS.map((id) => [`MAILER_TEMPLATES_${id}_CONTENT`, '<p>body</p>'])
      )

      expect(env(config)).toEqual(
        Object.fromEntries(
          TEMPLATE_IDS.map((id) => [
            `GOTRUE_MAILER_TEMPLATES_${id}`,
            `https://studio.example.com/templates/${id.toLowerCase()}/content`,
          ])
        )
      )
    })

    it('leaves the subjects to the default rule', () => {
      expect(env({ MAILER_SUBJECTS_RECOVERY: 'Reset your password' })).toEqual({
        GOTRUE_MAILER_SUBJECTS_RECOVERY: 'Reset your password',
      })
    })
  })

  describe('OAuth providers', () => {
    it('appends the additional client ids to the primary one', () => {
      // GoTrue's `.External.Google.ClientID` is a `[]string`, filled by splitting one value on
      // commas. There is no separate env for the additional ids.
      expect(
        env({
          EXTERNAL_GOOGLE_CLIENT_ID: 'web.apps.googleusercontent.com',
          EXTERNAL_GOOGLE_ADDITIONAL_CLIENT_IDS: 'ios.apps.googleusercontent.com, android.apps',
        })
      ).toEqual({
        GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID:
          'web.apps.googleusercontent.com,ios.apps.googleusercontent.com,android.apps',
      })
    })

    it('does the same for Apple, whose client id field is a []string too', () => {
      expect(
        env({
          EXTERNAL_APPLE_CLIENT_ID: 'com.example.web',
          EXTERNAL_APPLE_ADDITIONAL_CLIENT_IDS: 'com.example.ios',
        })
      ).toEqual({ GOTRUE_EXTERNAL_APPLE_CLIENT_ID: 'com.example.web,com.example.ios' })
    })

    it('drops blank ids instead of leaving an empty entry for GoTrue to read', () => {
      expect(
        env({ EXTERNAL_GOOGLE_CLIENT_ID: '', EXTERNAL_GOOGLE_ADDITIONAL_CLIENT_IDS: 'only.one' })
      ).toEqual({ GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID: 'only.one' })
    })

    it('clears the client id when both keys are empty', () => {
      expect(
        env({ EXTERNAL_GOOGLE_CLIENT_ID: '', EXTERNAL_GOOGLE_ADDITIONAL_CLIENT_IDS: '' })
      ).toEqual({ GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID: '' })
    })

    it('leaves the client id alone when neither key is given', () => {
      expect(env({ EXTERNAL_GOOGLE_ENABLED: false })).toEqual({
        GOTRUE_EXTERNAL_GOOGLE_ENABLED: 'false',
      })
    })

    it('adds the callback URL for every provider that is turned on', () => {
      expect(env({ EXTERNAL_GITHUB_ENABLED: true, EXTERNAL_LINKEDIN_OIDC_ENABLED: true })).toEqual({
        GOTRUE_EXTERNAL_GITHUB_ENABLED: 'true',
        GOTRUE_EXTERNAL_GITHUB_REDIRECT_URI: 'https://gotrue.example.com/auth/v1/callback',
        GOTRUE_EXTERNAL_LINKEDIN_OIDC_ENABLED: 'true',
        GOTRUE_EXTERNAL_LINKEDIN_OIDC_REDIRECT_URI: 'https://gotrue.example.com/auth/v1/callback',
      })
    })

    it('adds no callback URL for a provider that is turned off', () => {
      expect(env({ EXTERNAL_GITHUB_ENABLED: false })).toEqual({
        GOTRUE_EXTERNAL_GITHUB_ENABLED: 'false',
      })
    })

    it('adds no callback URL at all when there is no external URL to build one from', () => {
      // `SUPABASE_PUBLIC_URL` unset would otherwise write the bare path `/auth/v1/callback`, which
      // no OAuth provider can redirect to and which would overwrite a correct redirect URI set in
      // the compose file. Leaving the key out lets that one stand.
      expect(env({ EXTERNAL_GITHUB_ENABLED: true }, { ...CTX, apiExternalUrl: '' })).toEqual({
        GOTRUE_EXTERNAL_GITHUB_ENABLED: 'true',
      })
    })

    it('adds no callback URL for the sign-in methods that are not OAuth', () => {
      expect(
        env({
          EXTERNAL_EMAIL_ENABLED: true,
          EXTERNAL_PHONE_ENABLED: true,
          EXTERNAL_ANONYMOUS_USERS_ENABLED: true,
          EXTERNAL_WEB3_SOLANA_ENABLED: true,
          EXTERNAL_WEB3_ETHEREUM_ENABLED: true,
        })
      ).toEqual({
        GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
        GOTRUE_EXTERNAL_PHONE_ENABLED: 'true',
        GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: 'true',
        GOTRUE_EXTERNAL_WEB3_SOLANA_ENABLED: 'true',
        GOTRUE_EXTERNAL_WEB3_ETHEREUM_ENABLED: 'true',
      })
    })

    it('keeps the provider names that GoTrue spells out in full', () => {
      expect(
        env({
          EXTERNAL_LINKEDIN_OIDC_SECRET: 'li',
          EXTERNAL_SLACK_OIDC_SECRET: 'sl',
          EXTERNAL_X_SECRET: 'x',
        })
      ).toEqual({
        GOTRUE_EXTERNAL_LINKEDIN_OIDC_SECRET: 'li',
        GOTRUE_EXTERNAL_SLACK_OIDC_SECRET: 'sl',
        GOTRUE_EXTERNAL_X_SECRET: 'x',
      })
    })
  })

  describe('connection pool', () => {
    it('writes a connection count to the pool size, and zeroes the percentage', () => {
      expect(env({ DB_MAX_POOL_SIZE: 20, DB_MAX_POOL_SIZE_UNIT: 'connections' })).toEqual({
        GOTRUE_DB_MAX_POOL_SIZE: '20',
        GOTRUE_DB_CONN_PERCENTAGE: '0',
      })
    })

    it('treats a missing unit as connections', () => {
      expect(env({ DB_MAX_POOL_SIZE: 20 })).toEqual({
        GOTRUE_DB_MAX_POOL_SIZE: '20',
        GOTRUE_DB_CONN_PERCENTAGE: '0',
      })
    })

    it('writes a percentage to the other field, and zeroes the pool size', () => {
      expect(env({ DB_MAX_POOL_SIZE: 30, DB_MAX_POOL_SIZE_UNIT: 'percent' })).toEqual({
        GOTRUE_DB_CONN_PERCENTAGE: '30',
        GOTRUE_DB_MAX_POOL_SIZE: '0',
      })
    })

    it('lets a switch back to connections actually take effect', () => {
      // Both GoTrue fields are sticky, and a non-zero percentage decides the pool size on its own
      // (`internal/storage/dial.go:234`). Writing only the field the unit selected would leave the
      // previous percentage in force: the dashboard would change and nothing else would.
      const percent = env({ DB_MAX_POOL_SIZE: 30, DB_MAX_POOL_SIZE_UNIT: 'percent' })
      const connections = env({ DB_MAX_POOL_SIZE: 20, DB_MAX_POOL_SIZE_UNIT: 'connections' })

      expect(percent.GOTRUE_DB_CONN_PERCENTAGE).toBe('30')
      expect(connections.GOTRUE_DB_CONN_PERCENTAGE).toBe('0')
      expect(Object.keys(percent).sort()).toEqual(Object.keys(connections).sort())
    })
  })

  describe('pass-through keys', () => {
    it('writes the hook, allow-list and password keys exactly as given', () => {
      expect(
        env({
          HOOK_SEND_EMAIL_SECRETS: 'v1,whsec_abc|v1,whsec_def',
          URI_ALLOW_LIST: 'https://a.example.com/**,https://b.example.com/*',
          PASSWORD_REQUIRED_CHARACTERS: 'abcdefghijklmnopqrstuvwxyz:0123456789',
          SESSIONS_TAGS: 'one,two',
        })
      ).toEqual({
        GOTRUE_HOOK_SEND_EMAIL_SECRETS: 'v1,whsec_abc|v1,whsec_def',
        GOTRUE_URI_ALLOW_LIST: 'https://a.example.com/**,https://b.example.com/*',
        GOTRUE_PASSWORD_REQUIRED_CHARACTERS: 'abcdefghijklmnopqrstuvwxyz:0123456789',
        GOTRUE_SESSIONS_TAGS: 'one,two',
      })
    })
  })

  describe('keys that never reach the file', () => {
    it('skips the computed, UI-only and quota keys', () => {
      expect(
        env({
          MAILER_SUBJECTS_CUSTOM_CONTENTS: { MAILER_SUBJECTS_INVITE: true },
          MAILER_TEMPLATES_CUSTOM_CONTENTS: { MAILER_TEMPLATES_INVITE_CONTENT: true },
          DB_MAX_POOL_SIZE_UNIT: 'percent',
          CUSTOM_OAUTH_MAX_PROVIDERS: 5,
        })
      ).toEqual({})
    })

    it('skips a key the platform contract does not have', () => {
      // A key that reaches here came out of a state file an older Studio wrote, not from a PATCH.
      // `renderEnvFile` throws on a name like `GOTRUE_toString`, which would fail the whole save.
      expect(
        env({ GOTRUE_SITE_URL: 'already prefixed', REMOVED_IN_A_LATER_VERSION: 'x', toString: 'y' })
      ).toEqual({})
    })

    it('skips the keys GoTrue has no field for', () => {
      expect(
        env({
          MFA_ALLOW_LOW_AAL: true,
          NIMBUS_OAUTH_CLIENT_ID: 'nimbus',
          NIMBUS_OAUTH_CLIENT_SECRET: 'secret',
        })
      ).toEqual({})
    })

    it('writes something for every other managed key', () => {
      // The check that a key cannot go missing by accident: give every managed key a value and
      // the only ones that produce no env line at all are the four we mean to drop.
      const silent = [...MANAGED_KEYS].filter(
        (key) => Object.keys(env({ [key]: sampleValue(key) })).length === 0
      )

      expect(silent.sort()).toEqual([
        'CUSTOM_OAUTH_MAX_PROVIDERS',
        'DB_MAX_POOL_SIZE_UNIT',
        'MFA_ALLOW_LOW_AAL',
        'NIMBUS_OAUTH_CLIENT_ID',
        'NIMBUS_OAUTH_CLIENT_SECRET',
      ])
    })
  })

  it('maps a realistic configuration', () => {
    expect(
      env({
        SITE_URL: 'https://app.example.com',
        URI_ALLOW_LIST: 'https://app.example.com/**',
        JWT_EXP: 3600,
        EXTERNAL_GOOGLE_ENABLED: true,
        EXTERNAL_GOOGLE_CLIENT_ID: 'web.apps.googleusercontent.com',
        EXTERNAL_GOOGLE_ADDITIONAL_CLIENT_IDS: 'ios.apps.googleusercontent.com',
        EXTERNAL_GOOGLE_SECRET: 'google-secret',
        EXTERNAL_GITHUB_ENABLED: true,
        EXTERNAL_GITHUB_CLIENT_ID: 'github-client',
        EXTERNAL_GITHUB_SECRET: 'github-secret',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587',
        SMTP_USER: 'postmaster@example.com',
        SMTP_PASS: 'smtp-password',
        SMTP_ADMIN_EMAIL: 'admin@example.com',
        SMTP_SENDER_NAME: 'Example',
        SMTP_MAX_FREQUENCY: 60,
        SESSIONS_TIMEBOX: 24,
        SESSIONS_INACTIVITY_TIMEOUT: 0,
        HOOK_SEND_EMAIL_ENABLED: true,
        HOOK_SEND_EMAIL_URI: 'pg-functions://postgres/public/send_email',
        HOOK_SEND_EMAIL_SECRETS: '',
        MAILER_SUBJECTS_CONFIRMATION: 'Confirm your email',
        MAILER_TEMPLATES_CONFIRMATION_CONTENT: '<p>Confirm</p>',
        DB_MAX_POOL_SIZE: 10,
        DB_MAX_POOL_SIZE_UNIT: 'connections',
        CUSTOM_OAUTH_MAX_PROVIDERS: 5,
        MFA_ALLOW_LOW_AAL: false,
      })
    ).toEqual({
      GOTRUE_SITE_URL: 'https://app.example.com',
      GOTRUE_URI_ALLOW_LIST: 'https://app.example.com/**',
      GOTRUE_JWT_EXP: '3600',
      GOTRUE_EXTERNAL_GOOGLE_ENABLED: 'true',
      GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI: 'https://gotrue.example.com/auth/v1/callback',
      GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID:
        'web.apps.googleusercontent.com,ios.apps.googleusercontent.com',
      GOTRUE_EXTERNAL_GOOGLE_SECRET: 'google-secret',
      GOTRUE_EXTERNAL_GITHUB_ENABLED: 'true',
      GOTRUE_EXTERNAL_GITHUB_REDIRECT_URI: 'https://gotrue.example.com/auth/v1/callback',
      GOTRUE_EXTERNAL_GITHUB_CLIENT_ID: 'github-client',
      GOTRUE_EXTERNAL_GITHUB_SECRET: 'github-secret',
      GOTRUE_SMTP_HOST: 'smtp.example.com',
      GOTRUE_SMTP_PORT: '587',
      GOTRUE_SMTP_USER: 'postmaster@example.com',
      GOTRUE_SMTP_PASS: 'smtp-password',
      GOTRUE_SMTP_ADMIN_EMAIL: 'admin@example.com',
      GOTRUE_SMTP_SENDER_NAME: 'Example',
      GOTRUE_SMTP_MAX_FREQUENCY: '60s',
      GOTRUE_SESSIONS_TIMEBOX: '24h',
      GOTRUE_HOOK_SEND_EMAIL_ENABLED: 'true',
      GOTRUE_HOOK_SEND_EMAIL_URI: 'pg-functions://postgres/public/send_email',
      GOTRUE_HOOK_SEND_EMAIL_SECRETS: '',
      GOTRUE_MAILER_SUBJECTS_CONFIRMATION: 'Confirm your email',
      GOTRUE_MAILER_TEMPLATES_CONFIRMATION:
        'https://studio.example.com/templates/confirmation/content',
      GOTRUE_DB_MAX_POOL_SIZE: '10',
      GOTRUE_DB_CONN_PERCENTAGE: '0',
    })
  })

  it('is pure: the same input gives the same output, and the input is untouched', () => {
    const config = { SITE_URL: 'https://app.example.com', SESSIONS_TIMEBOX: 24 }

    expect(env(config)).toEqual(env(config))
    expect(config).toEqual({ SITE_URL: 'https://app.example.com', SESSIONS_TIMEBOX: 24 })
  })
})

/** A value of the type the platform declares for a key, for the "nothing goes missing" check. */
function sampleValue(key: string): string | number | boolean {
  const fallback = (DEFAULTS as Record<string, unknown>)[key]

  if (typeof fallback === 'boolean') return true
  if (typeof fallback === 'number') return 1
  // The six nullable keys and the five that only the update body declares have no default.
  if (fallback === undefined && (key.endsWith('_ENABLED') || key.endsWith('_OPTIONAL'))) return true

  return 'value'
}
