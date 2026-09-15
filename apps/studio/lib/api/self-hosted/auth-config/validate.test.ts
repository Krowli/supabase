import { describe, expect, it } from 'vitest'

import { PlatformConfig } from './mapping'
import { validatePatch } from './validate'

const check = (patch: Record<string, unknown>, current: Record<string, unknown> = {}) =>
  validatePatch(patch, current as PlatformConfig)

/** The message of a rejection, or `null` when the patch was accepted. */
const rejection = (patch: Record<string, unknown>, current: Record<string, unknown> = {}) => {
  const result = check(patch, current)
  return result.ok ? null : result.message
}

describe('api/self-hosted/auth-config/validate', () => {
  describe('unknown keys', () => {
    it('rejects a key the platform contract does not have', () => {
      expect(rejection({ GOTRUE_SITE_URL: 'https://a.example.com' })).toBe(
        'Unknown auth config key: GOTRUE_SITE_URL'
      )
      expect(rejection({ SECURITY_REFRESH_TOKEN_ROTATION_ENABLED: true })).toBe(
        'Unknown auth config key: SECURITY_REFRESH_TOKEN_ROTATION_ENABLED'
      )
    })

    it('accepts a key the contract does have', () => {
      expect(check({ REFRESH_TOKEN_ROTATION_ENABLED: true })).toEqual({ ok: true })
    })

    it('names a read-only key as read-only rather than unknown', () => {
      expect(rejection({ MAILER_SUBJECTS_CUSTOM_CONTENTS: {} })).toBe(
        'MAILER_SUBJECTS_CUSTOM_CONTENTS is read-only'
      )
      expect(rejection({ MAILER_TEMPLATES_CUSTOM_CONTENTS: {} })).toBe(
        'MAILER_TEMPLATES_CUSTOM_CONTENTS is read-only'
      )
    })
  })

  describe('value types', () => {
    it('rejects an object or an array for any key', () => {
      expect(rejection({ SITE_URL: { href: 'https://a.example.com' } })).toBe(
        'SITE_URL must be a string, number or boolean'
      )
      expect(rejection({ URI_ALLOW_LIST: ['https://a.example.com'] })).toBe(
        'URI_ALLOW_LIST must be a string, number or boolean'
      )
    })

    it('rejects a non-boolean for a boolean key', () => {
      expect(rejection({ MAILER_AUTOCONFIRM: 'true' })).toBe('MAILER_AUTOCONFIRM must be a boolean')
      expect(rejection({ EXTERNAL_GITHUB_ENABLED: 1 })).toBe(
        'EXTERNAL_GITHUB_ENABLED must be a boolean'
      )
      expect(rejection({ DISABLE_SIGNUP: 'yes' })).toBe('DISABLE_SIGNUP must be a boolean')
      expect(rejection({ SMS_AUTOCONFIRM: 0 })).toBe('SMS_AUTOCONFIRM must be a boolean')
      expect(rejection({ SESSIONS_SINGLE_PER_USER: 'no' })).toBe(
        'SESSIONS_SINGLE_PER_USER must be a boolean'
      )
      expect(rejection({ AUDIT_LOG_DISABLE_POSTGRES: '' })).toBe(
        'AUDIT_LOG_DISABLE_POSTGRES must be a boolean'
      )
      expect(rejection({ PASSWORD_HIBP_ENABLED: 'on' })).toBe(
        'PASSWORD_HIBP_ENABLED must be a boolean'
      )
    })

    it('accepts a boolean for a boolean key', () => {
      expect(
        check({
          MAILER_AUTOCONFIRM: true,
          EXTERNAL_GITHUB_ENABLED: false,
          DISABLE_SIGNUP: false,
          SMS_AUTOCONFIRM: true,
          SESSIONS_SINGLE_PER_USER: true,
          AUDIT_LOG_DISABLE_POSTGRES: false,
          PASSWORD_HIBP_ENABLED: true,
        })
      ).toEqual({ ok: true })
    })

    it('rejects a non-number for a number key', () => {
      expect(rejection({ RATE_LIMIT_EMAIL_SENT: '30' })).toBe(
        'RATE_LIMIT_EMAIL_SENT must be a number'
      )
      expect(rejection({ JWT_EXP: '3600' })).toBe('JWT_EXP must be a number')
      expect(rejection({ MAILER_OTP_EXP: true })).toBe('MAILER_OTP_EXP must be a number')
      expect(rejection({ MAILER_OTP_LENGTH: '6' })).toBe('MAILER_OTP_LENGTH must be a number')
      expect(rejection({ PASSWORD_MIN_LENGTH: '8' })).toBe('PASSWORD_MIN_LENGTH must be a number')
      expect(rejection({ MFA_MAX_ENROLLED_FACTORS: '10' })).toBe(
        'MFA_MAX_ENROLLED_FACTORS must be a number'
      )
      expect(rejection({ API_MAX_REQUEST_DURATION: '10' })).toBe(
        'API_MAX_REQUEST_DURATION must be a number'
      )
      expect(rejection({ DB_MAX_POOL_SIZE: '20' })).toBe('DB_MAX_POOL_SIZE must be a number')
    })

    it('accepts a number for a number key', () => {
      expect(
        check({
          RATE_LIMIT_EMAIL_SENT: 30,
          JWT_EXP: 3600,
          MAILER_OTP_EXP: 86400,
          MAILER_OTP_LENGTH: 6,
          PASSWORD_MIN_LENGTH: 8,
          MFA_MAX_ENROLLED_FACTORS: 10,
          API_MAX_REQUEST_DURATION: 10,
          DB_MAX_POOL_SIZE: 20,
        })
      ).toEqual({ ok: true })
    })

    it('accepts null for any key, which is how a value is cleared', () => {
      expect(check({ SITE_URL: null, JWT_EXP: null, MAILER_AUTOCONFIRM: null })).toEqual({
        ok: true,
      })
    })
  })

  describe('SITE_URL', () => {
    it('rejects a value that is not a URL', () => {
      expect(rejection({ SITE_URL: 'app.example.com' })).toBe(
        'SITE_URL must be a valid URL: app.example.com'
      )
      expect(rejection({ SITE_URL: '' })).toBe('SITE_URL must be a valid URL: ')
      expect(rejection({ SITE_URL: 3 })).toBe('SITE_URL must be a string')
    })

    it('accepts a URL', () => {
      expect(check({ SITE_URL: 'https://app.example.com' })).toEqual({ ok: true })
      expect(check({ SITE_URL: 'http://localhost:3000' })).toEqual({ ok: true })
    })
  })

  describe('URI_ALLOW_LIST', () => {
    it('rejects an empty entry', () => {
      expect(rejection({ URI_ALLOW_LIST: 'https://a.example.com,,https://b.example.com' })).toBe(
        'URI_ALLOW_LIST has an empty entry'
      )
    })

    it('rejects whitespace inside an entry', () => {
      expect(rejection({ URI_ALLOW_LIST: 'https://a.example.com/my path' })).toBe(
        'URI_ALLOW_LIST entry contains whitespace: https://a.example.com/my path'
      )
    })

    it('rejects a character no URL or glob uses', () => {
      expect(rejection({ URI_ALLOW_LIST: 'https://a.example.com/"quoted"' })).toBe(
        'URI_ALLOW_LIST entry has an unsupported character: https://a.example.com/"quoted"'
      )
    })

    it('rejects an unbalanced glob, which panics GoTrue on startup', () => {
      expect(rejection({ URI_ALLOW_LIST: 'https://a.example.com/[abc' })).toBe(
        'URI_ALLOW_LIST entry has unbalanced brackets: https://a.example.com/[abc'
      )
      expect(rejection({ URI_ALLOW_LIST: 'https://a.example.com/{a}}' })).toBe(
        'URI_ALLOW_LIST entry has unbalanced brackets: https://a.example.com/{a}}'
      )
      expect(rejection({ URI_ALLOW_LIST: 'https://a.example.com/[a}' })).toBe(
        'URI_ALLOW_LIST entry has unbalanced brackets: https://a.example.com/[a}'
      )
    })

    it('accepts a list of URLs and globs', () => {
      expect(
        check({
          URI_ALLOW_LIST:
            'https://a.example.com/**, https://b.example.com/*, https://c.example.com/[abc]/?',
        })
      ).toEqual({ ok: true })
    })

    it('accepts an empty list, which removes every extra redirect URL', () => {
      expect(check({ URI_ALLOW_LIST: '' })).toEqual({ ok: true })
    })
  })

  describe('captcha', () => {
    it('rejects turning captcha on without a secret', () => {
      expect(
        rejection({ SECURITY_CAPTCHA_ENABLED: true }, { SECURITY_CAPTCHA_PROVIDER: 'hcaptcha' })
      ).toBe('SECURITY_CAPTCHA_SECRET is required when captcha is enabled')
      expect(
        rejection(
          { SECURITY_CAPTCHA_ENABLED: true, SECURITY_CAPTCHA_SECRET: '   ' },
          { SECURITY_CAPTCHA_PROVIDER: 'hcaptcha' }
        )
      ).toBe('SECURITY_CAPTCHA_SECRET is required when captcha is enabled')
    })

    it('rejects a provider GoTrue does not implement', () => {
      expect(
        rejection({
          SECURITY_CAPTCHA_ENABLED: true,
          SECURITY_CAPTCHA_SECRET: 'secret',
          SECURITY_CAPTCHA_PROVIDER: 'recaptcha',
        })
      ).toBe("SECURITY_CAPTCHA_PROVIDER must be 'hcaptcha' or 'turnstile'")
    })

    it('accepts a secret that is already stored rather than sent again', () => {
      expect(
        check(
          { SECURITY_CAPTCHA_ENABLED: true },
          { SECURITY_CAPTCHA_SECRET: 'stored', SECURITY_CAPTCHA_PROVIDER: 'turnstile' }
        )
      ).toEqual({ ok: true })
    })

    it('accepts turning captcha off with nothing else set', () => {
      expect(check({ SECURITY_CAPTCHA_ENABLED: false })).toEqual({ ok: true })
    })

    it('leaves a patch that does not touch captcha alone', () => {
      // Otherwise one bad stored value would block every later save, including the one that fixes
      // it.
      expect(
        check({ SITE_URL: 'https://app.example.com' }, { SECURITY_CAPTCHA_ENABLED: true })
      ).toEqual({ ok: true })
    })
  })

  describe('session limits', () => {
    it('rejects a negative or oversized number of hours', () => {
      expect(rejection({ SESSIONS_TIMEBOX: -1 })).toBe(
        'SESSIONS_TIMEBOX must be between 0 and 8760 hours'
      )
      expect(rejection({ SESSIONS_INACTIVITY_TIMEOUT: 8761 })).toBe(
        'SESSIONS_INACTIVITY_TIMEOUT must be between 0 and 8760 hours'
      )
      expect(rejection({ SESSIONS_TIMEBOX: '24' })).toBe(
        'SESSIONS_TIMEBOX must be a number of hours'
      )
    })

    it('accepts 0, which disables the limit, and anything up to a year', () => {
      expect(check({ SESSIONS_TIMEBOX: 0, SESSIONS_INACTIVITY_TIMEOUT: 8760 })).toEqual({
        ok: true,
      })
    })
  })

  describe('SECURITY_REFRESH_TOKEN_REUSE_INTERVAL', () => {
    it('rejects a fraction or a value outside 0 to 300', () => {
      expect(rejection({ SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: 10.5 })).toBe(
        'SECURITY_REFRESH_TOKEN_REUSE_INTERVAL must be a whole number of seconds'
      )
      expect(rejection({ SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: 301 })).toBe(
        'SECURITY_REFRESH_TOKEN_REUSE_INTERVAL must be between 0 and 300 seconds'
      )
      expect(rejection({ SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: -1 })).toBe(
        'SECURITY_REFRESH_TOKEN_REUSE_INTERVAL must be between 0 and 300 seconds'
      )
    })

    it('accepts a whole number of seconds inside the range', () => {
      expect(check({ SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: 0 })).toEqual({ ok: true })
      expect(check({ SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: 300 })).toEqual({ ok: true })
    })
  })

  describe('hook URIs', () => {
    it('rejects a Postgres function whose schema or name is not an identifier', () => {
      expect(rejection({ HOOK_SEND_SMS_URI: 'pg-functions://postgres/public/send sms' })).toBe(
        'HOOK_SEND_SMS_URI names an invalid Postgres schema or function: pg-functions://postgres/public/send sms'
      )
      expect(rejection({ HOOK_SEND_SMS_URI: 'pg-functions://postgres/9schema/hook' })).toBe(
        'HOOK_SEND_SMS_URI names an invalid Postgres schema or function: pg-functions://postgres/9schema/hook'
      )
    })

    it('rejects plain HTTP to a host that is not local', () => {
      expect(rejection({ HOOK_SEND_EMAIL_URI: 'http://hooks.example.com/send' })).toBe(
        'HOOK_SEND_EMAIL_URI may only use http:// for a local host, not hooks.example.com'
      )
    })

    it('rejects a scheme that is neither pg-functions nor HTTP', () => {
      expect(rejection({ HOOK_CUSTOM_ACCESS_TOKEN_URI: 'ftp://example.com/hook' })).toBe(
        'HOOK_CUSTOM_ACCESS_TOKEN_URI must be a pg-functions:// or https:// URI'
      )
      expect(rejection({ HOOK_CUSTOM_ACCESS_TOKEN_URI: 'not a uri' })).toBe(
        'HOOK_CUSTOM_ACCESS_TOKEN_URI must be a pg-functions:// or https:// URI'
      )
    })

    it('accepts a Postgres function, HTTPS, and HTTP to a local host', () => {
      expect(
        check({
          HOOK_SEND_SMS_URI: 'pg-functions://postgres/public/send_sms',
          HOOK_SEND_EMAIL_URI: 'https://hooks.example.com/send',
          HOOK_MFA_VERIFICATION_ATTEMPT_URI: 'http://localhost:9999/mfa',
          HOOK_PASSWORD_VERIFICATION_ATTEMPT_URI: 'http://host.docker.internal:9999/password',
          HOOK_BEFORE_USER_CREATED_URI: 'http://127.0.0.1:9999/before',
          HOOK_AFTER_USER_CREATED_URI: 'http://[::1]:9999/after',
        })
      ).toEqual({ ok: true })
    })

    it('accepts an empty URI, which removes the hook', () => {
      expect(check({ HOOK_SEND_SMS_URI: '' })).toEqual({ ok: true })
    })
  })

  describe('hook secrets', () => {
    it('rejects a secret in neither supported format', () => {
      expect(rejection({ HOOK_SEND_EMAIL_SECRETS: 'whsec_abc' })).toBe(
        'HOOK_SEND_EMAIL_SECRETS contains a secret that is not in the v1,whsec_ or v1a,whpk_ format'
      )
      expect(rejection({ HOOK_SEND_EMAIL_SECRETS: 'v1,whsec_abc|oops' })).toBe(
        'HOOK_SEND_EMAIL_SECRETS contains a secret that is not in the v1,whsec_ or v1a,whpk_ format'
      )
      expect(rejection({ HOOK_SEND_EMAIL_SECRETS: 'v1a,whpk_only' })).toBe(
        'HOOK_SEND_EMAIL_SECRETS contains a secret that is not in the v1,whsec_ or v1a,whpk_ format'
      )
    })

    it('accepts both formats, alone and combined', () => {
      expect(
        check({
          HOOK_SEND_EMAIL_SECRETS: 'v1,whsec_dGVzdA==|v1a,whpk_publickey:whsk_secretkey',
          HOOK_SEND_SMS_SECRETS: 'v1,whsec_abc123',
        })
      ).toEqual({ ok: true })
    })

    it('accepts no secrets at all, which turns signing off', () => {
      expect(check({ HOOK_SEND_EMAIL_SECRETS: '' })).toEqual({ ok: true })
    })
  })

  describe('passkeys', () => {
    it('rejects turning passkeys on without the relying-party fields', () => {
      expect(rejection({ PASSKEY_ENABLED: true })).toBe(
        'WEBAUTHN_RP_ID is required when passkeys are enabled'
      )
      expect(rejection({ PASSKEY_ENABLED: true, WEBAUTHN_RP_ID: 'app.example.com' })).toBe(
        'WEBAUTHN_RP_DISPLAY_NAME is required when passkeys are enabled'
      )
    })

    it('accepts them when both fields are set, in the patch or already stored', () => {
      expect(
        check(
          { PASSKEY_ENABLED: true, WEBAUTHN_RP_ID: 'app.example.com' },
          { WEBAUTHN_RP_DISPLAY_NAME: 'Example' }
        )
      ).toEqual({ ok: true })
    })

    it('accepts turning passkeys off with nothing else set', () => {
      expect(check({ PASSKEY_ENABLED: false })).toEqual({ ok: true })
    })
  })

  describe('SMTP_PORT', () => {
    it('rejects anything that is not a port number as text', () => {
      expect(rejection({ SMTP_PORT: 587 })).toBe('SMTP_PORT must be a string of digits')
      expect(rejection({ SMTP_PORT: '58a' })).toBe('SMTP_PORT must be a string of digits')
      expect(rejection({ SMTP_PORT: '' })).toBe('SMTP_PORT must be a string of digits')
      expect(rejection({ SMTP_PORT: '0' })).toBe('SMTP_PORT must be between 1 and 65535')
      expect(rejection({ SMTP_PORT: '65536' })).toBe('SMTP_PORT must be between 1 and 65535')
    })

    it('accepts a port in range', () => {
      expect(check({ SMTP_PORT: '587' })).toEqual({ ok: true })
      expect(check({ SMTP_PORT: '65535' })).toEqual({ ok: true })
    })
  })

  it('accepts an empty patch', () => {
    expect(check({})).toEqual({ ok: true })
  })
})
