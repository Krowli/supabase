import { components } from 'api-types'

import { COMPUTED_KEYS, TEMPLATE_IDS } from './defaults'
import { PLATFORM_CONFIG_TYPES } from './keys.generated'

/**
 * A partial platform auth config, the shape both the GET response and a PATCH body take.
 *
 * It is `GoTrueConfigResponse` because that is what the UI reads back. Five keys exist only on
 * `UpdateGoTrueConfigBody` (`EXTERNAL_WORKOS_ENABLED`, `EXTERNAL_X_*`), so they are absent from
 * this type but present in `MANAGED_KEYS` and handled by `toEnv`, which walks the object's own
 * keys rather than the type's.
 */
export type PlatformConfig = Partial<components['schemas']['GoTrueConfigResponse']>

/**
 * Keys that qualify another key rather than carrying a setting of their own. They govern emission
 * only: `toEnv` never writes one as an env line, but it still reads `DB_MAX_POOL_SIZE_UNIT` to
 * decide which GoTrue field the pool size belongs in.
 *
 * They are still managed. `UpdateGoTrueConfigBody` declares `DB_MAX_POOL_SIZE_UNIT`, so the UI
 * sends it, and leaving it out of `MANAGED_KEYS` would make every pool-size change fail as an
 * unknown key.
 */
export const UI_ONLY_KEYS = ['DB_MAX_POOL_SIZE_UNIT'] as const

const UI_ONLY: ReadonlySet<string> = new Set<string>(UI_ONLY_KEYS)

/**
 * Platform keys with no GoTrue counterpart. Studio stores them so the UI round-trips, and never
 * writes them to `99_studio.env`.
 *
 * - `MFA_ALLOW_LOW_AAL` — the platform types it `boolean`, GoTrue's `GOTRUE_SESSIONS_ALLOW_LOW_AAL`
 *   is a `*time.Duration` (`internal/conf/configuration.go`, `.Sessions.AllowLowAAL`). The
 *   platform's translation from the one to the other is not public, and guessing a duration from a
 *   boolean would write a value no one asked for.
 * - `NIMBUS_OAUTH_CLIENT_ID` / `NIMBUS_OAUTH_CLIENT_SECRET` — no field anywhere in GoTrue's
 *   configuration; these belong to the hosted platform's own OAuth app.
 */
export const UNMAPPED_KEYS: ReadonlySet<string> = new Set([
  'MFA_ALLOW_LOW_AAL',
  'NIMBUS_OAUTH_CLIENT_ID',
  'NIMBUS_OAUTH_CLIENT_SECRET',
])

/**
 * Every platform key Studio accepts on a PATCH and keeps in its state: the whole contract except
 * the computed keys, which Studio derives rather than stores.
 */
export const MANAGED_KEYS: ReadonlySet<string> = new Set(
  Object.keys(PLATFORM_CONFIG_TYPES).filter(
    (key) => !(COMPUTED_KEYS as readonly string[]).includes(key)
  )
)

/** A hosted-plan quota GoTrue reads from its own licence, never from the environment. */
const QUOTA_KEY = 'CUSTOM_OAUTH_MAX_PROVIDERS'

/**
 * Platform keys whose GoTrue env name is not `GOTRUE_` + the key.
 *
 * GoTrue's field is `Security.RefreshTokenRotationEnabled`, so envconfig names it
 * `GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED`, but the platform contract spells the key
 * without the `SECURITY_` prefix. Deriving this one mechanically writes an env line GoTrue ignores,
 * which silently leaves rotation at its default.
 *
 * A `Map`, not an object: this is looked up by a key that came in over the wire, and an object
 * literal answers `toString` or `constructor` with something inherited from `Object.prototype`.
 */
const ENV_NAME_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  ['REFRESH_TOKEN_ROTATION_ENABLED', 'GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED'],
])

/**
 * Managed keys whose GoTrue field is `string` or has `[]string` as its underlying type — the only
 * fields where `KEY=""` is a legal value. Anything else parses `""` as a malformed int, bool,
 * float or duration and fails the whole config reload, taking every other setting in the file with
 * it, so an empty value for those keys is dropped instead.
 *
 * Read off `internal/conf/configuration.go` in the GoTrue clone by walking `GlobalConfiguration`
 * the way envconfig does, then matching each env name back to its platform key.
 * `PasswordRequiredCharacters` (line 293) and `HTTPHookSecrets` (line 945) are named `[]string`
 * types with a `Decode`, and both accept an empty string.
 *
 * `SMTP_PORT` is deliberately absent: the platform types it `string`, GoTrue's `.SMTP.Port` is an
 * `int`.
 *
 * So are `SMS_TEST_OTP` (`map[string]string`) and `SMS_TEST_OTP_VALID_UNTIL` (a custom `Time`).
 * The consequence is worth knowing: a test OTP set once and then cleared in the UI is **not**
 * cleared in GoTrue. The empty value is dropped, the key leaves the file, and GoTrue keeps the last
 * value it read. Clearing those two takes a reset in the running container.
 *
 * Both would in fact survive a `""` — envconfig skips an empty map value, and `Time` exists
 * precisely because `time.Time.UnmarshalText` cannot parse one (`configuration.go:38`). They are
 * excluded anyway, because the rule is drawn on the declared Go type rather than on a per-field
 * reading of what each decoder tolerates, and a rule that needs that reading is one a later change
 * to GoTrue can invalidate silently.
 *
 * Exported because `validatePatch` decides the same question for an enum key: an empty value means
 * "unset", and it may only be accepted where this set says it can be written.
 */
export const STRING_TYPED_KEYS: ReadonlySet<string> = new Set([
  'EXTERNAL_APPLE_CLIENT_ID',
  'EXTERNAL_APPLE_SECRET',
  'EXTERNAL_AZURE_CLIENT_ID',
  'EXTERNAL_AZURE_SECRET',
  'EXTERNAL_AZURE_URL',
  'EXTERNAL_BITBUCKET_CLIENT_ID',
  'EXTERNAL_BITBUCKET_SECRET',
  'EXTERNAL_DISCORD_CLIENT_ID',
  'EXTERNAL_DISCORD_SECRET',
  'EXTERNAL_FACEBOOK_CLIENT_ID',
  'EXTERNAL_FACEBOOK_SECRET',
  'EXTERNAL_FIGMA_CLIENT_ID',
  'EXTERNAL_FIGMA_SECRET',
  'EXTERNAL_GITHUB_CLIENT_ID',
  'EXTERNAL_GITHUB_SECRET',
  'EXTERNAL_GITLAB_CLIENT_ID',
  'EXTERNAL_GITLAB_SECRET',
  'EXTERNAL_GITLAB_URL',
  'EXTERNAL_GOOGLE_CLIENT_ID',
  'EXTERNAL_GOOGLE_SECRET',
  'EXTERNAL_KAKAO_CLIENT_ID',
  'EXTERNAL_KAKAO_SECRET',
  'EXTERNAL_KEYCLOAK_CLIENT_ID',
  'EXTERNAL_KEYCLOAK_SECRET',
  'EXTERNAL_KEYCLOAK_URL',
  'EXTERNAL_LINKEDIN_OIDC_CLIENT_ID',
  'EXTERNAL_LINKEDIN_OIDC_SECRET',
  'EXTERNAL_NOTION_CLIENT_ID',
  'EXTERNAL_NOTION_SECRET',
  'EXTERNAL_SLACK_CLIENT_ID',
  'EXTERNAL_SLACK_OIDC_CLIENT_ID',
  'EXTERNAL_SLACK_OIDC_SECRET',
  'EXTERNAL_SLACK_SECRET',
  'EXTERNAL_SPOTIFY_CLIENT_ID',
  'EXTERNAL_SPOTIFY_SECRET',
  'EXTERNAL_TWITCH_CLIENT_ID',
  'EXTERNAL_TWITCH_SECRET',
  'EXTERNAL_TWITTER_CLIENT_ID',
  'EXTERNAL_TWITTER_SECRET',
  'EXTERNAL_WORKOS_CLIENT_ID',
  'EXTERNAL_WORKOS_SECRET',
  'EXTERNAL_WORKOS_URL',
  'EXTERNAL_X_CLIENT_ID',
  'EXTERNAL_X_SECRET',
  'EXTERNAL_ZOOM_CLIENT_ID',
  'EXTERNAL_ZOOM_SECRET',
  'HOOK_AFTER_USER_CREATED_SECRETS',
  'HOOK_AFTER_USER_CREATED_URI',
  'HOOK_BEFORE_USER_CREATED_SECRETS',
  'HOOK_BEFORE_USER_CREATED_URI',
  'HOOK_CUSTOM_ACCESS_TOKEN_SECRETS',
  'HOOK_CUSTOM_ACCESS_TOKEN_URI',
  'HOOK_MFA_VERIFICATION_ATTEMPT_SECRETS',
  'HOOK_MFA_VERIFICATION_ATTEMPT_URI',
  'HOOK_PASSWORD_VERIFICATION_ATTEMPT_SECRETS',
  'HOOK_PASSWORD_VERIFICATION_ATTEMPT_URI',
  'HOOK_SEND_EMAIL_SECRETS',
  'HOOK_SEND_EMAIL_URI',
  'HOOK_SEND_SMS_SECRETS',
  'HOOK_SEND_SMS_URI',
  'MAILER_SUBJECTS_CONFIRMATION',
  'MAILER_SUBJECTS_EMAIL_CHANGE',
  'MAILER_SUBJECTS_EMAIL_CHANGED_NOTIFICATION',
  'MAILER_SUBJECTS_IDENTITY_LINKED_NOTIFICATION',
  'MAILER_SUBJECTS_IDENTITY_UNLINKED_NOTIFICATION',
  'MAILER_SUBJECTS_INVITE',
  'MAILER_SUBJECTS_MAGIC_LINK',
  'MAILER_SUBJECTS_MFA_FACTOR_ENROLLED_NOTIFICATION',
  'MAILER_SUBJECTS_MFA_FACTOR_UNENROLLED_NOTIFICATION',
  'MAILER_SUBJECTS_PASSWORD_CHANGED_NOTIFICATION',
  'MAILER_SUBJECTS_PHONE_CHANGED_NOTIFICATION',
  'MAILER_SUBJECTS_REAUTHENTICATION',
  'MAILER_SUBJECTS_RECOVERY',
  'MFA_PHONE_TEMPLATE',
  'OAUTH_SERVER_AUTHORIZATION_PATH',
  'PASSWORD_REQUIRED_CHARACTERS',
  'SAML_EXTERNAL_URL',
  'SECURITY_CAPTCHA_PROVIDER',
  'SECURITY_CAPTCHA_SECRET',
  'SESSIONS_TAGS',
  'SITE_URL',
  'SMS_MESSAGEBIRD_ACCESS_KEY',
  'SMS_MESSAGEBIRD_ORIGINATOR',
  'SMS_PROVIDER',
  'SMS_TEMPLATE',
  'SMS_TEXTLOCAL_API_KEY',
  'SMS_TEXTLOCAL_SENDER',
  'SMS_TWILIO_ACCOUNT_SID',
  'SMS_TWILIO_AUTH_TOKEN',
  'SMS_TWILIO_CONTENT_SID',
  'SMS_TWILIO_MESSAGE_SERVICE_SID',
  'SMS_TWILIO_VERIFY_ACCOUNT_SID',
  'SMS_TWILIO_VERIFY_AUTH_TOKEN',
  'SMS_TWILIO_VERIFY_MESSAGE_SERVICE_SID',
  'SMS_VONAGE_API_KEY',
  'SMS_VONAGE_API_SECRET',
  'SMS_VONAGE_FROM',
  'SMTP_ADMIN_EMAIL',
  'SMTP_HOST',
  'SMTP_PASS',
  'SMTP_SENDER_NAME',
  'SMTP_USER',
  'URI_ALLOW_LIST',
  'WEBAUTHN_RP_DISPLAY_NAME',
  'WEBAUTHN_RP_ID',
  'WEBAUTHN_RP_ORIGINS',
])

/** Seconds on the platform, a Go duration string in GoTrue. */
const SECONDS_AS_DURATION: ReadonlySet<string> = new Set([
  'API_MAX_REQUEST_DURATION',
  'MFA_PHONE_MAX_FREQUENCY',
  'SMS_MAX_FREQUENCY',
  'SMTP_MAX_FREQUENCY',
])

/**
 * Hours on the platform, a Go duration string in GoTrue. Both are `*time.Duration`, where nil means
 * "no limit"; the platform says the same thing with `0`, and `"0"` would be read as an active limit
 * of zero, so a `0` here omits the key entirely and leaves GoTrue on its own nil default.
 */
const HOURS_AS_DURATION: ReadonlySet<string> = new Set([
  'SESSIONS_INACTIVITY_TIMEOUT',
  'SESSIONS_TIMEBOX',
])

/** `MAILER_TEMPLATES_<ID>_CONTENT` → `<ID>`. An exact map, because the ids overlap as prefixes. */
const TEMPLATE_CONTENT_KEYS: ReadonlyMap<string, string> = new Map(
  TEMPLATE_IDS.map((id) => [`MAILER_TEMPLATES_${id}_CONTENT`, id])
)

/**
 * Providers whose extra client ids are a separate platform key but the same GoTrue field: both
 * `.External.Apple.ClientID` and `.External.Google.ClientID` are `[]string`, which envconfig fills
 * by splitting one env value on commas.
 */
const ADDITIONAL_CLIENT_ID_PROVIDERS = ['APPLE', 'GOOGLE'] as const

/** The client-id keys folded together after the main pass, so neither order nor absence matters. */
const FOLDED_CLIENT_ID_KEYS: ReadonlySet<string> = new Set(
  ADDITIONAL_CLIENT_ID_PROVIDERS.flatMap((provider) => [
    `EXTERNAL_${provider}_CLIENT_ID`,
    `EXTERNAL_${provider}_ADDITIONAL_CLIENT_IDS`,
  ])
)

/** `EXTERNAL_<X>_ENABLED` keys that are not an OAuth provider and so have no redirect URI. */
const NON_OAUTH_PROVIDERS: ReadonlySet<string> = new Set(['ANONYMOUS_USERS', 'EMAIL', 'PHONE'])

/** The provider in an `EXTERNAL_<P>_ENABLED` key, when that provider is an OAuth one. */
function oauthProviderOf(key: string): string | undefined {
  const match = /^EXTERNAL_(.+)_ENABLED$/.exec(key)
  if (match === null) return undefined

  const provider = match[1]
  if (NON_OAUTH_PROVIDERS.has(provider) || provider.startsWith('WEB3_')) return undefined

  return provider
}

/**
 * The primary client id followed by the additional ones, as the single comma-separated value
 * GoTrue's `[]string` field expects. Blank entries are dropped: an empty primary would otherwise
 * leave a leading comma, and envconfig would hand GoTrue an empty client id as a real one.
 */
function joinClientIds(primary: unknown, additional: unknown): string {
  const ids = [
    ...(typeof primary === 'string' ? [primary] : []),
    ...(typeof additional === 'string' ? additional.split(',') : []),
  ]

  return ids
    .map((id) => id.trim())
    .filter((id) => id !== '')
    .join(',')
}

/**
 * The env map for `99_studio.env`, given a platform auth config. Pure: same input, same output.
 *
 * `ctx.templateBaseUrl` is where Studio serves the email template bodies it holds, and
 * `ctx.apiExternalUrl` is the address GoTrue is reachable at from a browser, which is what an
 * OAuth provider redirects back to.
 */
export function toEnv(
  config: PlatformConfig,
  ctx: { templateBaseUrl: string; apiExternalUrl: string }
): Record<string, string> {
  const source = config as Record<string, unknown>
  const env: Record<string, string> = {}

  for (const key of Object.keys(source)) {
    const value = source[key]

    if (value === null || value === undefined) continue

    // `MANAGED_KEYS` excludes the computed keys, and also catches a key the contract no longer
    // has: `validatePatch` refuses an unknown key, so one arriving here came out of a state file
    // an older Studio wrote, and `renderEnvFile` would reject the name.
    if (!MANAGED_KEYS.has(key) || key === QUOTA_KEY || UI_ONLY.has(key)) continue
    if (UNMAPPED_KEYS.has(key) || FOLDED_CLIENT_ID_KEYS.has(key)) continue

    // GoTrue takes a URL for a template body, never the body itself. An empty string is how it is
    // told to go back to its built-in template, so a cleared body still has to be written.
    const templateId = TEMPLATE_CONTENT_KEYS.get(key)
    if (templateId !== undefined) {
      const customised = typeof value === 'string' && value !== ''
      env[`GOTRUE_MAILER_TEMPLATES_${templateId}`] = customised
        ? `${ctx.templateBaseUrl}/${templateId.toLowerCase()}/content`
        : ''
      continue
    }

    if (key === 'DB_MAX_POOL_SIZE') {
      if (typeof value !== 'number') continue
      const percent = source.DB_MAX_POOL_SIZE_UNIT === 'percent'
      env[percent ? 'GOTRUE_DB_CONN_PERCENTAGE' : 'GOTRUE_DB_MAX_POOL_SIZE'] = String(value)
      continue
    }

    // A malformed duration fails the whole config reload, so a value that is not a number is
    // dropped rather than passed through as text.
    if (SECONDS_AS_DURATION.has(key)) {
      if (typeof value === 'number') env[`GOTRUE_${key}`] = `${value}s`
      continue
    }

    if (HOURS_AS_DURATION.has(key)) {
      if (typeof value === 'number' && value !== 0) env[`GOTRUE_${key}`] = `${value}h`
      continue
    }

    const provider = value === true ? oauthProviderOf(key) : undefined
    if (provider !== undefined) {
      env[`GOTRUE_EXTERNAL_${provider}_REDIRECT_URI`] = `${ctx.apiExternalUrl}/auth/v1/callback`
    }

    const name = ENV_NAME_EXCEPTIONS.get(key) ?? `GOTRUE_${key}`

    if (typeof value === 'boolean') env[name] = value ? 'true' : 'false'
    else if (typeof value === 'number') env[name] = String(value)
    else if (typeof value === 'string' && (value !== '' || STRING_TYPED_KEYS.has(key)))
      env[name] = value
  }

  for (const provider of ADDITIONAL_CLIENT_ID_PROVIDERS) {
    const primary = source[`EXTERNAL_${provider}_CLIENT_ID`]
    const additional = source[`EXTERNAL_${provider}_ADDITIONAL_CLIENT_IDS`]

    const given = [primary, additional].filter((value) => value !== null && value !== undefined)
    if (given.length === 0) continue

    env[`GOTRUE_EXTERNAL_${provider}_CLIENT_ID`] = joinClientIds(primary, additional)
  }

  return env
}
